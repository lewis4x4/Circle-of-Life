/**
 * Compliance types for Circle of Life
 * Covers multi-entity awareness, FL statute references, and background screening
 * Source: HAVEN-COL-TECHNICAL-HANDOFF.md §12 Module 08 — Compliance Engine
 */

import type { FacilityName, EntityType } from './facility';

// ─── Screening enums ─────────────────────────────────────────────────────────

export type ScreeningStatus = 'CLEARED' | 'PENDING' | 'EXPIRED' | 'FAILED';

export type ScreeningType = 'FDLE_FBI_LEVEL_2';

// ─── Legal Entity interface ──────────────────────────────────────────────────

/**
 * Each COL facility operates under a distinct legal entity.
 * Compliance documents, invoices, and resident agreements MUST reference
 * the correct entity. Cross-entity data mixing is a compliance violation.
 */
export interface LegalEntity {
  id: string;
  facility: FacilityName;
  /** Exact legal name from AHCA license / Sunbiz filing */
  legal_entity_name: string;
  entity_type: EntityType;
  ein: string;
  /** PENDING — Brian obtaining from client */
  ahca_license_number: string | null;
  /** PENDING — Brian obtaining from client */
  ahca_license_expiration: string | null;
  last_survey_date: string | null;
  last_survey_result: 'PASSED_NO_CITATIONS' | 'CITATIONS_OPEN' | 'CITATIONS_CLEARED';
  /** Confirmed zero open POCs for all 5 facilities as of 2026-04-10 */
  open_pocs: number;
}

// ─── FL Statute cross-reference ──────────────────────────────────────────────

/**
 * Florida statute citations used throughout Haven compliance engine.
 * Each module references specific FL statute sections for audit trails.
 */
export interface FlStatute {
  id: string;
  /** FL statute section, e.g. "429.255" */
  statute_section: string;
  /** Human-readable title */
  title: string;
  /** Which Haven module(s) this statute applies to */
  applicable_modules: string[];
  /** Brief description of compliance requirement */
  requirement_summary: string;
  /** Whether violation triggers mandatory reporting */
  mandatory_reporting: boolean;
  /** Penalty classification */
  penalty_class: 'CLASS_I' | 'CLASS_II' | 'CLASS_III' | 'CLASS_IV' | null;
}

// ─── Background Screening ────────────────────────────────────────────────────

/**
 * FDLE/FBI Level 2 background screening tracking.
 * Source: New Hire Packet — AHCA Attestation Form #3100-0008
 * Legal basis: FL §435.04, §408.809
 *
 * Alert thresholds:
 *   YELLOW: renewal_date < today + 30 days
 *   RED:    renewal_date < today → employee CANNOT work
 */
export interface BackgroundScreening {
  id: string;
  employee_id: string;
  screening_date: string;
  /** Annual renewal date from training records */
  renewal_date: string;
  screening_type: ScreeningType;
  /** Whether FL Clearinghouse was used for verification */
  clearinghouse_reference: boolean;
  /** AHCA Attestation Form #3100-0008 reference */
  ahca_attestation_form: string;
  status: ScreeningStatus;
}

// ─── Arbitration Agreement tracking ──────────────────────────────────────────

/**
 * Source: Appendix E of all resident agreements.
 * 30-day rescission period — if rescission_deadline < today AND rescinded === false → binding.
 */
export interface ArbitrationAgreement {
  id: string;
  resident_id: string;
  signed_date: string;
  /** signed_date + 30 calendar days */
  rescission_deadline: string;
  rescinded: boolean;
  governing_law: 'FAA';
  arbitrator_panel_size: 3;
  class_action_waiver: true;
}

// ─── Compliance escalation contacts (FL hardcoded) ───────────────────────────

export const COMPLIANCE_CONTACTS = {
  state_survey: '800-962-2873',
  ltc_ombudsman: '888-831-0404',
  elder_abuse: '800-962-2873',
  disability_rights_fl: '800-342-0823',
  osha: '800-321-6742',
} as const;

// ─── Drill compliance ────────────────────────────────────────────────────────

export type DrillType = 'FIRE' | 'ELOPEMENT';

export interface DrillRequirement {
  type: DrillType;
  frequency_per_year: number;
  interval_months: number;
  form: string;
  compliance_fields: string[];
}

export const DRILL_REQUIREMENTS: DrillRequirement[] = [
  {
    type: 'FIRE',
    frequency_per_year: 6,
    interval_months: 2,
    form: 'fire_drill_form',
    compliance_fields: ['date', 'time', 'participants', 'results'],
  },
  {
    type: 'ELOPEMENT',
    frequency_per_year: 2,
    interval_months: 6,
    form: 'elopement_drill_form',
    compliance_fields: [
      'date_of_drill',
      'time_started',
      'time_completed',
      'person_in_charge',
      'summary_results',
      'staff_participants',
      'rooms_common_areas_searched',
    ],
  },
];
