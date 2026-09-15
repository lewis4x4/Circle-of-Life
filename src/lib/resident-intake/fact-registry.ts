import { z } from "zod";

export const SOURCE_CLASSIFICATIONS = [
  "resident",
  "facility",
  "employee",
  "other_resident",
  "credential_secret",
  "unreadable",
  "unsupported",
] as const;

export const RESIDENT_DOCUMENT_CLASSES = [
  "demographics_face_sheet",
  "form_1823",
  "photo_identification",
  "insurance_card",
  "prescription_benefit_card",
  "physician_orders_medication_list",
  "advance_directive",
  "authority_instrument",
  "admission_agreement",
  "financial_agreement",
  "arbitration",
  "resident_rights",
  "hipaa_privacy",
  "photo_release",
  "secured_environment_acknowledgment",
  "medication_assistance_consent",
  "behavioral_health_consent_referral",
  "provider_enrollment_consent",
  "resident_screening",
  "dietary_evaluation",
  "tb_screening",
  "care_plan_service_plan_acknowledgment",
  "other_resident_evidence",
] as const;

export type ResidentDocumentClass = (typeof RESIDENT_DOCUMENT_CLASSES)[number];
export type ReviewerClass = "general" | "nurse" | "payer" | "authority";
export type CanonicalWriter =
  | "resident"
  | "resident_contact"
  | "resident_document"
  | "assessment"
  | "medication_order"
  | "resident_payer"
  | "advance_directive"
  | "resident_contract"
  | "admission_case"
  | "form_1823"
  | "resident_profile_fact"
  | "resident_authority_instrument"
  | "resident_pharmacy_benefit"
  | "resident_screening";

const text = z.string().trim().min(1).max(2_000);
const shortText = z.string().trim().min(1).max(300);
const date = z.iso.date();
const nullableDate = date.nullable();
const boolean = z.boolean();
const stringList = z.array(shortText).max(100);
const phone = z.string().trim().min(3).max(40);
const email = z.email().max(254);
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const enumValue = <T extends readonly [string, ...string[]]>(values: T) => z.enum(values);
const payerType = enumValue(["private_pay", "medicaid_oss", "ltc_insurance", "va_aid_attendance", "other"]);
const contractType = enumValue([
  "admission_agreement", "financial_agreement", "arbitration_agreement", "resident_rights_acknowledgment",
  "hipaa_privacy_consent", "service_plan_acknowledgment", "medicaid_assignment", "photo_release",
  "secured_environment_acknowledgment", "medication_assistance_consent", "provider_enrollment_consent",
  "behavioral_health_consent", "directive_cover_sheet", "other",
]);
const medicationFrequency = enumValue(["daily", "bid", "tid", "qid", "qhs", "qam", "prn", "weekly", "biweekly", "monthly", "other"]);
const medicationRoute = enumValue(["oral", "sublingual", "topical", "ophthalmic", "otic", "nasal", "inhaled", "rectal", "transdermal", "subcutaneous", "intramuscular", "other"]);
const medicationOrder = z.object({
  medication_name: shortText,
  generic_name: shortText.nullable().optional(),
  strength: shortText,
  form: shortText,
  route: medicationRoute,
  frequency: medicationFrequency,
  frequency_detail: shortText.nullable().optional(),
  scheduled_times: z.array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/)).max(24),
  instructions: text,
  indication: text.nullable().optional(),
  prescriber_name: shortText,
  prescriber_phone: phone.nullable().optional(),
  pharmacy_name: shortText.nullable().optional(),
  order_date: date,
  start_date: date,
  end_date: nullableDate.optional(),
  controlled_schedule: enumValue(["ii", "iii", "iv", "v", "non_controlled"]),
  prn_reason: text.nullable().optional(),
  prn_max_frequency: text.nullable().optional(),
  prn_effectiveness_check_minutes: z.number().int().positive().max(1_440).nullable().optional(),
  witness_required: boolean.optional(),
  geofence_enforced: boolean.optional(),
}).strict().superRefine((order, context) => {
  if (order.frequency === "prn" && !order.prn_max_frequency) context.addIssue({ code: "custom", message: "PRN orders require prn_max_frequency" });
  if (order.frequency !== "prn" && order.scheduled_times.length === 0) context.addIssue({ code: "custom", message: "Scheduled orders require scheduled_times" });
});
const boundedJsonValue: z.ZodType<unknown> = z.lazy(() => z.union([
  z.string().max(2_000),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.array(boundedJsonValue).max(100),
  z.record(z.string().min(1).max(100), boundedJsonValue),
]));
const boundedJsonObject = z.record(z.string().min(1).max(100), boundedJsonValue);
const form1823Adl = enumValue(["independent", "supervision", "assistance", "dependent", "not_assessed"]);
const form1823MedicationAssistance = enumValue([
  "self_administered",
  "assistance_with_self_administration",
  "administered_by_licensed_staff",
  "not_assessed",
]);
const form1823Schema = z.object({
  physician_name: shortText.nullable(),
  exam_date: date.nullable(),
  expiration_date: date.nullable(),
  representative_name: shortText.nullable(),
  representative_relationship: shortText.nullable(),
  representative_phone: phone.nullable(),
  allergies: stringList,
  height_inches: z.number().positive().max(120).nullable(),
  weight_lbs: z.number().positive().max(1_500).nullable(),
  medical_history: boundedJsonObject,
  physical_limitations: boundedJsonObject,
  cognitive_behavioral_status: boundedJsonObject,
  service_requirements: boundedJsonObject,
  precautions: boundedJsonObject,
  elopement_risk: boolean.nullable(),
  adl_bathing: form1823Adl.nullable(),
  adl_dressing: form1823Adl.nullable(),
  adl_eating: form1823Adl.nullable(),
  adl_transferring: form1823Adl.nullable(),
  adl_toileting: form1823Adl.nullable(),
  adl_grooming: form1823Adl.nullable(),
  adl_walking: form1823Adl.nullable(),
  prescribed_diet: text.nullable(),
  condition_communicable_disease: boolean.nullable(),
  condition_bedridden: boolean.nullable(),
  condition_pressure_injury: boolean.nullable(),
  condition_tuberculosis: boolean.nullable(),
  condition_special_precautions: boolean.nullable(),
  alf_care_appropriate: boolean.nullable(),
  medication_assistance: form1823MedicationAssistance.nullable(),
  examiner_license_number: shortText.nullable(),
  examiner_license_type: shortText.nullable(),
  examiner_title: shortText.nullable(),
  examiner_phone: phone.nullable(),
  examiner_address: text.nullable(),
  examiner_signature_date: date.nullable(),
  source_pages: z.array(z.number().int().positive()).min(1).max(100),
  checklist_note: text,
}).strict().superRefine((form, context) => {
  if (form.exam_date && form.expiration_date && form.expiration_date < form.exam_date) {
    context.addIssue({ code: "custom", message: "Form 1823 expiration cannot precede the exam date" });
  }
  if (new Set(form.source_pages).size !== form.source_pages.length) {
    context.addIssue({ code: "custom", message: "Form 1823 source pages must be unique" });
  }
});

export type FactDefinition = {
  label: string;
  group: "identity" | "clinical" | "contacts" | "payer" | "authority" | "admission" | "screening";
  reviewer: ReviewerClass;
  writer: CanonicalWriter;
  valueSchema: z.ZodType;
  checklistType?: ResidentDocumentClass;
  conflictSensitive?: boolean;
};

/**
 * Server-owned allowlist. Provider output and manual proposals are both
 * validated here before they can reach a database command. Writers are
 * descriptive identifiers consumed by the database; neither clients nor the
 * extraction provider can provide a table, column, or SQL path.
 */
export const RESIDENT_FACT_REGISTRY = {
  "resident.first_name": { label: "First name", group: "identity", reviewer: "general", writer: "resident", valueSchema: shortText },
  "resident.middle_name": { label: "Middle name", group: "identity", reviewer: "general", writer: "resident", valueSchema: shortText.nullable() },
  "resident.last_name": { label: "Last name", group: "identity", reviewer: "general", writer: "resident", valueSchema: shortText },
  "resident.preferred_name": { label: "Preferred name", group: "identity", reviewer: "general", writer: "resident", valueSchema: shortText.nullable() },
  "resident.date_of_birth": { label: "Date of birth", group: "identity", reviewer: "general", writer: "resident", valueSchema: date, conflictSensitive: true },
  "resident.gender": { label: "Gender", group: "identity", reviewer: "general", writer: "resident", valueSchema: enumValue(["male", "female", "non_binary", "other", "prefer_not_to_say"]), conflictSensitive: true },
  "resident.ssn_last_four": { label: "SSN last four", group: "identity", reviewer: "payer", writer: "resident", valueSchema: z.string().regex(/^\d{4}$/) },
  "resident.primary_physician_name": { label: "Primary physician", group: "contacts", reviewer: "nurse", writer: "resident", valueSchema: shortText },
  "resident.primary_physician_phone": { label: "Primary physician phone", group: "contacts", reviewer: "nurse", writer: "resident", valueSchema: phone },
  "resident.primary_physician_fax": { label: "Primary physician fax", group: "contacts", reviewer: "nurse", writer: "resident", valueSchema: phone },
  "resident.primary_diagnosis": { label: "Primary diagnosis", group: "clinical", reviewer: "nurse", writer: "resident", valueSchema: shortText, conflictSensitive: true },
  "resident.diagnosis_list": { label: "Diagnoses", group: "clinical", reviewer: "nurse", writer: "resident_profile_fact", valueSchema: stringList, conflictSensitive: true },
  "resident.allergy_list": { label: "Allergies", group: "clinical", reviewer: "nurse", writer: "resident_profile_fact", valueSchema: stringList, conflictSensitive: true },
  "resident.diet_order": { label: "Diet order", group: "clinical", reviewer: "nurse", writer: "resident", valueSchema: text, conflictSensitive: true },
  "resident.diet_restrictions": { label: "Diet restrictions", group: "clinical", reviewer: "nurse", writer: "resident_profile_fact", valueSchema: stringList, conflictSensitive: true },
  "resident.code_status": { label: "Code status", group: "clinical", reviewer: "nurse", writer: "resident", valueSchema: shortText, conflictSensitive: true },
  "resident.ambulatory": { label: "Ambulatory status", group: "clinical", reviewer: "nurse", writer: "resident", valueSchema: boolean, conflictSensitive: true },
  "resident.assistive_device": { label: "Assistive device", group: "clinical", reviewer: "nurse", writer: "resident_profile_fact", valueSchema: text, conflictSensitive: true },
  "resident.fall_risk_level": { label: "Fall risk", group: "clinical", reviewer: "nurse", writer: "resident", valueSchema: enumValue(["low", "moderate", "high"]), conflictSensitive: true },
  "resident.elopement_risk": { label: "Elopement risk", group: "clinical", reviewer: "nurse", writer: "resident", valueSchema: boolean, conflictSensitive: true },
  "resident.wandering_risk": { label: "Wandering risk", group: "clinical", reviewer: "nurse", writer: "resident", valueSchema: boolean, conflictSensitive: true },
  "resident.smoking_status": { label: "Smoking status", group: "clinical", reviewer: "nurse", writer: "resident", valueSchema: shortText, conflictSensitive: true },
  "resident.primary_payer": { label: "Primary payer", group: "payer", reviewer: "payer", writer: "resident", valueSchema: payerType, conflictSensitive: true },
  "resident.contact": { label: "Resident contact", group: "contacts", reviewer: "general", writer: "resident_contact", valueSchema: z.object({ target_id: uuid.optional(), contact_type: shortText, name: shortText, relationship: shortText.nullable().optional(), phone: phone.nullable().optional(), phone_alt: phone.nullable().optional(), email: email.nullable().optional(), fax: phone.nullable().optional(), address: text.nullable().optional(), is_emergency_contact: boolean.optional(), is_healthcare_proxy: boolean.optional(), is_power_of_attorney: boolean.optional(), notes: text.nullable().optional() }).strict() },
  "resident.assessment": { label: "Assessment", group: "clinical", reviewer: "nurse", writer: "assessment", valueSchema: z.object({ assessment_type: shortText, assessment_date: date, total_score: z.number().nullable().optional(), risk_level: shortText.nullable().optional(), scores: z.record(z.string().min(1).max(100), z.unknown()), notes: text.nullable().optional(), next_due_date: nullableDate.optional() }).strict() },
  "resident.payer": { label: "Payer", group: "payer", reviewer: "payer", writer: "resident_payer", valueSchema: z.object({ payer_type: payerType, effective_date: date, is_primary: boolean.optional(), payer_name: shortText.nullable().optional(), policy_number: shortText.nullable().optional(), group_number: shortText.nullable().optional(), payer_phone: phone.nullable().optional(), payer_contact_name: shortText.nullable().optional(), medicaid_recipient_id: shortText.nullable().optional(), end_date: nullableDate.optional(), notes: text.nullable().optional() }).strict(), conflictSensitive: true },
  "resident.advance_directive": { label: "Advance directive", group: "authority", reviewer: "authority", writer: "advance_directive", valueSchema: z.object({ document_type: shortText, polst_status: enumValue(["none", "on_file", "verified", "revoked"]), code_status: shortText.nullable().optional(), physician_signature_date: nullableDate.optional(), notes: text.nullable().optional() }).strict(), conflictSensitive: true },
  "resident.profile_fact": { label: "Resident profile fact", group: "identity", reviewer: "general", writer: "resident_profile_fact", valueSchema: z.object({ category: enumValue(["identity", "clinical", "preference", "safety", "admission", "other"]), field_code: z.string().regex(/^[a-z][a-z0-9_.]{1,79}$/), value: z.unknown(), effective_date: nullableDate.optional() }).strict() },
  "resident.authority_instrument": { label: "Authority instrument", group: "authority", reviewer: "authority", writer: "resident_authority_instrument", valueSchema: z.object({ instrument_type: enumValue(["healthcare_proxy", "durable_power_of_attorney", "guardianship", "representative_payee", "ssa_787", "other"]), holder_name: shortText, relationship: shortText.nullable().optional(), scope: stringList.min(1), status: enumValue(["reported", "under_review", "verified", "expired", "revoked", "disputed"]), effective_date: nullableDate.optional(), expiration_date: nullableDate.optional(), notes: text.nullable().optional() }).strict(), conflictSensitive: true },
  "resident.pharmacy_benefit": { label: "Pharmacy benefit", group: "payer", reviewer: "payer", writer: "resident_pharmacy_benefit", valueSchema: z.object({ processor_name: shortText.nullable().optional(), member_id: shortText, bin: shortText.nullable().optional(), pcn: shortText.nullable().optional(), group_number: shortText.nullable().optional() }).strict(), conflictSensitive: true },
  "resident.screening": { label: "Screening result", group: "screening", reviewer: "authority", writer: "resident_screening", valueSchema: z.object({ screening_type: enumValue(["background_registry", "sex_offender_registry", "tb", "behavioral_health", "admission", "other"]), searched_on: date, result: enumValue(["clear", "potential_match", "match", "inconclusive", "not_reviewed"]), notes: text.nullable().optional() }).strict() },
  "resident.provider_referral": { label: "Provider referral", group: "admission", reviewer: "general", writer: "admission_case", valueSchema: z.object({ provider_name: shortText, provider_phone: phone.nullable().optional(), referral_type: enumValue(["behavioral_health", "primary_care", "specialist", "therapy", "hospice", "home_health", "other"]), referred_on: date, status: enumValue(["documented", "pending", "accepted", "declined", "completed", "cancelled"]), notes: text.nullable().optional() }).strict() },
  "resident.contract": { label: "Agreement observation", group: "admission", reviewer: "authority", writer: "resident_contract", valueSchema: z.object({ contract_type: contractType, title: shortText.optional(), status: enumValue(["draft", "ready_to_send", "sent", "viewed", "partially_signed", "completed", "declined", "voided", "expired"]).optional(), effective_date: nullableDate.optional(), expiration_date: nullableDate.optional(), paper_signature_observation: z.object({ signer_name: shortText.nullable().optional(), signature_observed: boolean, signed_date: nullableDate.optional() }).strict().optional() }).strict() },
  "resident.medication_order": { label: "Medication order", group: "clinical", reviewer: "nurse", writer: "medication_order", valueSchema: z.object({ medication_id: uuid.optional(), previous_medication_id: uuid.optional(), action: enumValue(["save", "discontinue"]), reason: text, order: medicationOrder }).strict(), conflictSensitive: true },
  "admission.form_1823": { label: "Form 1823", group: "clinical", reviewer: "nurse", writer: "form_1823", valueSchema: form1823Schema, checklistType: "form_1823", conflictSensitive: true },
  "admission.checklist_evidence": { label: "Admission checklist evidence", group: "admission", reviewer: "general", writer: "admission_case", valueSchema: z.object({ document_type: z.enum(RESIDENT_DOCUMENT_CLASSES), required: boolean.optional(), notes: text.nullable().optional() }).strict() },
  "resident.room_evidence": { label: "Room or bed evidence", group: "admission", reviewer: "general", writer: "resident_profile_fact", valueSchema: shortText, conflictSensitive: true },
  "resident.admission_date_evidence": { label: "Admission date evidence", group: "admission", reviewer: "general", writer: "admission_case", valueSchema: date, conflictSensitive: true },
} as const satisfies Record<string, FactDefinition>;

export const RESIDENT_FACT_CODES = Object.keys(RESIDENT_FACT_REGISTRY) as [
  keyof typeof RESIDENT_FACT_REGISTRY,
  ...(keyof typeof RESIDENT_FACT_REGISTRY)[],
];

export type ResidentFactCode = keyof typeof RESIDENT_FACT_REGISTRY;

export function parseResidentFactValue(code: ResidentFactCode, value: unknown) {
  return RESIDENT_FACT_REGISTRY[code].valueSchema.safeParse(value);
}

export function factExtractionCatalog() {
  return RESIDENT_FACT_CODES.map((code) => {
    const fact = RESIDENT_FACT_REGISTRY[code];
    return {
      code,
      label: fact.label,
      reviewer: fact.reviewer,
      writer: fact.writer,
      value_schema: fact.valueSchema.toJSONSchema({ unrepresentable: "any" }),
    };
  });
}
