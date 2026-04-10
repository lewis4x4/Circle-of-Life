/**
 * Staff type extensions for Circle of Life
 * Extends the auto-generated staff_role enum with 14 COL-specific roles
 * Source: HAVEN-COL-TECHNICAL-HANDOFF.md §3 Org Chart Seed Data
 */

import type { Database } from './database';

// ─── Current DB enum values (11 existing in database.ts) ─────────────────────
// cna, lpn, rn, administrator, activities_director, dietary_staff,
// dietary_manager, maintenance, housekeeping, driver, other

// ─── Extended staff_role enum with 14 new COL-specific values ────────────────

/**
 * Full staff role enum combining existing DB values + 14 new COL roles.
 * Once the Supabase migration adds these values to the staff_role enum,
 * regenerate database.ts to pick them up automatically.
 */
export type StaffRole =
  // ── Existing DB values ──
  | 'cna'
  | 'lpn'
  | 'rn'
  | 'administrator'
  | 'activities_director'
  | 'dietary_staff'
  | 'dietary_manager'
  | 'maintenance'
  | 'housekeeping'
  | 'driver'
  | 'other'
  // ── 14 NEW values from COL org chart ──
  | 'owner'
  | 'ceo'
  | 'coo'
  | 'cfo'
  | 'assistant_administrator'
  | 'admin_support_coordinator'
  | 'marketing_consultant'
  | 'maintenance_director'
  | 'maintenance_standby'
  | 'medication_tech'
  | 'resident_aide'
  | 'dietary_aide'
  | 'activity_aide'
  | 'resident_services_coordinator';

/** New values only — use for the ALTER TYPE migration */
export const NEW_STAFF_ROLES = [
  'owner',
  'ceo',
  'coo',
  'cfo',
  'assistant_administrator',
  'admin_support_coordinator',
  'marketing_consultant',
  'maintenance_director',
  'maintenance_standby',
  'medication_tech',
  'resident_aide',
  'dietary_aide',
  'activity_aide',
  'resident_services_coordinator',
] as const;

// ─── Org level enum ──────────────────────────────────────────────────────────

export type OrgLevel = 'CORPORATE' | 'FACILITY';

// ─── Extended staff member interface ─────────────────────────────────────────

export interface StaffMember {
  id: string;
  full_name: string;
  staff_role: StaffRole;
  phone: string | null;
  facility_name: string | null; // null = corporate-level
  org_level: OrgLevel;
  email: string | null;
  hire_date: string | null;
  is_active: boolean;
}
