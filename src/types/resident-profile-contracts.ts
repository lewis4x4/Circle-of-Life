/**
 * Resident profile domain contracts (Module 03 handoff alignment).
 */

export enum CareServiceCategory {
  PERSONAL_CARE = "PERSONAL_CARE",
  MEDICATION_MANAGEMENT = "MEDICATION_MANAGEMENT",
  BEHAVIORAL_SUPPORT = "BEHAVIORAL_SUPPORT",
  DIETARY = "DIETARY",
  MOBILITY = "MOBILITY",
  CONTINENCE = "CONTINENCE",
  SKIN_WOUND = "SKIN_WOUND",
  COGNITIVE_SUPPORT = "COGNITIVE_SUPPORT",
  SOCIAL_RECREATIONAL = "SOCIAL_RECREATIONAL",
}

export interface CatheterFlag {
  hasCatheter: boolean;
  /** Acknowledgment that facility is not responsible for catheter changes unless contracted */
  acknowledgmentSigned: boolean;
  lastReviewedAt?: string | null;
}

export interface HomewoodProtocol {
  /** Homewood Lodge pilot enhancements */
  active: boolean;
  enhancedRounding: boolean;
  autoWanderGuardAssessment: boolean;
}

export enum ObservationType {
  ROUNDING = "ROUNDING",
  MEAL_OBSERVATION = "MEAL_OBSERVATION",
  BEHAVIORAL_CHECK_IN = "BEHAVIORAL_CHECK_IN",
  ELOPEMENT_WATCH = "ELOPEMENT_WATCH",
  SKIN_CHECK = "SKIN_CHECK",
  PAIN_ASSESSMENT = "PAIN_ASSESSMENT",
  OTHER = "OTHER",
}
