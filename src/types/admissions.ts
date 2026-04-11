/**
 * Admissions document + Form 1823 contracts (Track E / handoff parity).
 * Align with Postgres enums in migration `141_track_e_form_1823_and_admission_docs.sql`.
 */

export enum SuiteType {
  PRIVATE = "PRIVATE",
  SEMI_PRIVATE = "SEMI_PRIVATE",
}

export enum Form1823Status {
  PENDING = "pending",
  RECEIVED = "received",
  EXPIRED = "expired",
  RENEWAL_DUE = "renewal_due",
}

/** Mirrors `admission_document_type` enum (18 values). */
export enum AdmissionDocument {
  FORM_1823 = "form_1823",
  FACESHEET_DEMOGRAPHICS = "facesheet_demographics",
  PHOTO_IDENTIFICATION = "photo_identification",
  INSURANCE_FINANCIAL_CARDS = "insurance_financial_cards",
  ADMISSION_AGREEMENT = "admission_agreement",
  FINANCIAL_AGREEMENT = "financial_agreement",
  RESIDENT_ASSESSMENT = "resident_assessment",
  CARE_PLAN_ACKNOWLEDGMENT = "care_plan_acknowledgment",
  MEDICATION_LIST = "medication_list",
  ADVANCE_DIRECTIVES = "advance_directives",
  TUBERCULOSIS_SCREENING = "tuberculosis_screening",
  DIETARY_EVALUATION = "dietary_evaluation",
  PHYSICIAN_ORDERS = "physician_orders",
  PET_ADDENDUM = "pet_addendum",
  PRIVACY_PRACTICES_HIPAA = "privacy_practices_hipaa",
  RESIDENT_BILL_OF_RIGHTS = "resident_bill_of_rights",
  ACKNOWLEDGMENT_OF_RISK = "acknowledgment_of_risk",
  CATHETER_CARE = "catheter_care",
}

const BASE_REQUIRED: AdmissionDocument[] = [
  AdmissionDocument.FORM_1823,
  AdmissionDocument.FACESHEET_DEMOGRAPHICS,
  AdmissionDocument.PHOTO_IDENTIFICATION,
  AdmissionDocument.INSURANCE_FINANCIAL_CARDS,
  AdmissionDocument.ADMISSION_AGREEMENT,
  AdmissionDocument.FINANCIAL_AGREEMENT,
  AdmissionDocument.RESIDENT_ASSESSMENT,
  AdmissionDocument.CARE_PLAN_ACKNOWLEDGMENT,
  AdmissionDocument.MEDICATION_LIST,
  AdmissionDocument.ADVANCE_DIRECTIVES,
  AdmissionDocument.TUBERCULOSIS_SCREENING,
  AdmissionDocument.DIETARY_EVALUATION,
  AdmissionDocument.PHYSICIAN_ORDERS,
  AdmissionDocument.PET_ADDENDUM,
  AdmissionDocument.PRIVACY_PRACTICES_HIPAA,
  AdmissionDocument.RESIDENT_BILL_OF_RIGHTS,
  AdmissionDocument.ACKNOWLEDGMENT_OF_RISK,
];

/** Documents required for an admission; catheter packet only when applicable. */
export function requiredAdmissionDocuments(hasCatheter: boolean): AdmissionDocument[] {
  if (!hasCatheter) return BASE_REQUIRED;
  return [...BASE_REQUIRED, AdmissionDocument.CATHETER_CARE];
}
