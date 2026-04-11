/**
 * Facility type extensions for Circle of Life
 * Supplements auto-generated database.ts with COL-specific facility fields
 * Source: HAVEN-COL-TECHNICAL-HANDOFF.md §2 Facility Seed Data
 */

import type { Database } from './database';

// ─── Enums ───────────────────────────────────────────────────────────────────

export enum FacilityName {
  OAKRIDGE = 'OAKRIDGE',
  HOMEWOOD = 'HOMEWOOD',
  RISING_OAKS = 'RISING_OAKS',
  PLANTATION = 'PLANTATION',
  GRANDE_CYPRESS = 'GRANDE_CYPRESS',
}

export enum LicenseType {
  STANDARD_ALF = 'STANDARD_ALF',
  // COL does NOT hold any of these — included for schema completeness:
  // LNS = 'LNS',           // Limited Nursing Services
  // LMH = 'LMH',           // Limited Mental Health
  // ECC = 'ECC',            // Extended Congregate Care
}

export enum County {
  LAFAYETTE = 'LAFAYETTE',   // Oakridge, Homewood (Duke Energy)
  SUWANNEE = 'SUWANNEE',     // Rising Oaks (Suwannee Valley Electric)
  COLUMBIA = 'COLUMBIA',     // Plantation, Grande Cypress (FPL, Lake City PD)
}

export enum PharmacyVendor {
  BAYA_PHARMACY = 'BAYA_PHARMACY',                   // Oakridge, Homewood, Rising Oaks
  NORTH_FLORIDA_PHARMACY = 'NORTH_FLORIDA_PHARMACY', // Grande Cypress
}

export enum EntityType {
  FL_CORP = 'FL_CORP',
  FL_LLC = 'FL_LLC',
}

// ─── Facility overrides (JSONB column) ───────────────────────────────────────

/** Per-facility config overrides stored in facilities.facility_overrides JSONB */
export interface FacilityOverrides {
  /** Utility provider name (varies by county) */
  utility_provider?: string;
  /** Local law enforcement agency */
  local_pd?: string;
  /** Custom rate overrides per room type */
  rate_overrides?: Partial<Record<RoomType, number>>;
  /** Emergency contacts specific to this facility */
  emergency_contacts?: {
    name: string;
    phone: string;
    role: string;
  }[];
}

export type RoomType = 'PRIVATE' | 'SEMI_PRIVATE';

// ─── Extended facility row ───────────────────────────────────────────────────

type BaseFacilityRow = Database['public']['Tables']['facilities']['Row'];

/** Facility row extended with 5 new columns not yet in database.ts */
export interface FacilityRow extends BaseFacilityRow {
  /** JSONB — per-facility config overrides */
  facility_overrides: FacilityOverrides | null;
  /** Pharmacy vendor enum */
  pharmacy_vendor: PharmacyVendor | null;
  /** Current occupancy percentage (0.00–1.00) — list API may send 0–100; normalize in hooks */
  occupancy_pct: number | null;
  /** AHCA license number — PENDING: Brian obtaining from client */
  ahca_license_number: string | null;
  /** AHCA license expiration date — PENDING: Brian obtaining from client */
  ahca_license_expiration: string | null;
  /** List API: occupied bed count */
  occupancy_count?: number;
  total_beds?: number;
  /** UI alias for census */
  current_occupancy?: number;
  licensed_beds?: number;
  /** Legal entity display (detail API) */
  entity_name?: string | null;
  /** Migration 131 — care services (never `memory_care`) */
  care_services_offered?: string[] | null;
}

/** Optional fields returned by facility detail / list APIs */
export interface FacilityApiExtensions {
  entity?: { id: string; legal_name: string | null; dba_name: string | null } | null;
  entity_name?: string | null;
  occupancy_count?: number;
  total_beds?: number;
  /** Duplicate of occupancy_count for legacy UI */
  current_occupancy?: number;
  /** Duplicate of total_licensed_beds for legacy UI */
  licensed_beds?: number;
}

export type FacilityDetailRow = FacilityRow & FacilityApiExtensions;
