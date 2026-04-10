/**
 * Facility Admin Portal — Zod Validation Schemas
 * Source: blueprint-col-facility-admin-portal-2026-04-10
 * Pattern: matches src/lib/validation/user-management.ts
 */

import { z } from 'zod';
import {
  CONTACT_CATEGORIES,
  DOCUMENT_CATEGORIES,
  RATE_TYPES,
  THRESHOLD_TYPES,
  SURVEY_TYPES,
  SURVEY_RESULTS,
  TIMELINE_EVENT_TYPES,
  CARE_SERVICES,
  CONSTRUCTION_TYPES,
  FIRE_SUPPRESSION_TYPES,
  GENERATOR_FUEL_TYPES,
  FACILITY_TABS,
} from '@/lib/admin/facilities/facility-constants';

// ─── Facility List Query ─────────────────────────────────────────────────────

export const listFacilitiesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(50).default(20),
  search: z.string().optional(),
  status: z.enum(['all', 'active', 'inactive', 'under_renovation', 'archived']).default('all'),
  county: z.string().optional(),
  sort_by: z.enum(['name', 'occupancy_pct', 'total_licensed_beds', 'created_at']).default('name'),
  sort_order: z.enum(['asc', 'desc']).default('asc'),
});

export type ListFacilitiesQuery = z.infer<typeof listFacilitiesQuerySchema>;

// ─── Facility Detail Query ───────────────────────────────────────────────────

export const facilityDetailQuerySchema = z.object({
  tab: z.enum(FACILITY_TABS).default('overview'),
});

// ─── Facility Core Update ────────────────────────────────────────────────────

export const updateFacilitySchema = z.object({
  name: z.string().min(2).optional(),
  phone: z.string().min(10).optional(),
  fax: z.string().optional(),
  email: z.string().email().optional(),
  address_line_1: z.string().min(5).optional(),
  address_line_2: z.string().optional(),
  city: z.string().optional(),
  state: z.string().length(2).default('FL').optional(),
  zip: z.string().regex(/^\d{5}(-\d{4})?$/).optional(),
  county: z.string().optional(),
  administrator_name: z.string().optional(),
  current_administrator_id: z.string().uuid().optional(),
  care_services_offered: z.array(z.enum(CARE_SERVICES)).min(1).optional(),
  pharmacy_vendor: z.string().optional(),
  target_occupancy_pct: z.number().min(0).max(1).optional(),
  waitlist_count: z.number().int().min(0).optional(),
  opening_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  total_licensed_beds: z.number().int().min(1).optional(),
  status: z.enum(['active', 'inactive', 'under_renovation', 'archived']).optional(),
}).strict().refine(
  (data) => Object.keys(data).length > 0,
  { message: 'At least one field must be provided' }
);

export type UpdateFacilityInput = z.infer<typeof updateFacilitySchema>;

// ─── Rate Schedule ───────────────────────────────────────────────────────────

export const createRateSchema = z.object({
  rate_type: z.enum(RATE_TYPES),
  amount_cents: z.number().int().min(0),
  effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().optional(),
}).strict();

export type CreateRateInput = z.infer<typeof createRateSchema>;

export const listRatesQuerySchema = z.object({
  rate_type: z.enum(RATE_TYPES).optional(),
  active_only: z.coerce.boolean().default(true),
});

// ─── Emergency Contact ───────────────────────────────────────────────────────

export const emergencyContactSchema = z.object({
  contact_category: z.enum(CONTACT_CATEGORIES),
  contact_name: z.string().min(2),
  phone_primary: z.string().min(7),
  phone_secondary: z.string().optional(),
  address: z.string().optional(),
  distance_miles: z.number().min(0).optional(),
  drive_time_minutes: z.number().int().min(0).optional(),
  account_number: z.string().optional(),
  notes: z.string().optional(),
  sort_order: z.number().int().min(0).default(0),
}).strict();

export type EmergencyContactInput = z.infer<typeof emergencyContactSchema>;

// ─── Document Upload ─────────────────────────────────────────────────────────

export const documentMetadataSchema = z.object({
  document_category: z.enum(DOCUMENT_CATEGORIES),
  document_name: z.string().min(2),
  expiration_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  alert_yellow_days: z.number().int().min(1).default(60),
  alert_red_days: z.number().int().min(1).default(30),
  notes: z.string().optional(),
}).strict();

export type DocumentMetadataInput = z.infer<typeof documentMetadataSchema>;

// ─── Survey History ──────────────────────────────────────────────────────────

export const surveyHistorySchema = z.object({
  survey_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  survey_type: z.enum(SURVEY_TYPES),
  result: z.enum(SURVEY_RESULTS),
  citation_count: z.number().int().min(0).default(0),
  citation_details: z.array(z.object({
    tag: z.string(),
    description: z.string(),
    severity: z.string(),
    poc_due_date: z.string().optional(),
    poc_status: z.enum(['pending', 'submitted', 'accepted', 'rejected']).optional(),
  })).optional(),
  poc_submitted_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  poc_accepted_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  surveyor_names: z.array(z.string()).optional(),
  document_id: z.string().uuid().optional(),
  notes: z.string().optional(),
}).strict();

export type SurveyHistoryInput = z.infer<typeof surveyHistorySchema>;

// ─── Building Profile ────────────────────────────────────────────────────────

export const buildingProfileSchema = z.object({
  year_built: z.number().int().min(1900).max(2100).optional(),
  last_renovation_year: z.number().int().optional(),
  square_footage: z.number().int().min(0).optional(),
  number_of_floors: z.number().int().min(1).default(1),
  number_of_wings: z.number().int().min(0).optional(),
  construction_type: z.enum(CONSTRUCTION_TYPES).optional(),
  fire_suppression_type: z.enum(FIRE_SUPPRESSION_TYPES).optional(),
  fire_alarm_monitoring_company: z.string().optional(),
  fire_alarm_account_number: z.string().optional(),
  last_fire_inspection_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  next_fire_inspection_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  has_generator: z.boolean().default(false),
  generator_fuel_type: z.enum(GENERATOR_FUEL_TYPES).optional(),
  generator_capacity_kw: z.number().int().optional(),
  generator_last_test_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  generator_next_service_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  generator_service_vendor: z.string().optional(),
  kitchen_license_number: z.string().optional(),
  kitchen_license_expiration: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  last_kitchen_inspection_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  meal_times: z.record(z.string()).optional(),
  dietary_capabilities: z.array(z.string()).optional(),
  has_elevator: z.boolean().default(false),
  elevator_inspection_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  elevator_service_company: z.string().optional(),
  ada_compliant: z.boolean().default(true),
  ada_notes: z.string().optional(),
  parking_spaces: z.number().int().optional(),
  handicap_spaces: z.number().int().optional(),
  door_alarm_system: z.string().optional(),
  perimeter_description: z.string().optional(),
  wander_guard_system: z.string().optional(),
  nearest_crossroads: z.string().optional(),
  evacuation_partner_facility: z.string().optional(),
  evacuation_transport_capacity: z.number().int().optional(),
  shelter_in_place_capacity_days: z.number().int().default(3),
  emergency_water_supply_gallons: z.number().int().optional(),
  emergency_food_supply_expiration: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  electric_provider: z.string().optional(),
  electric_account_number: z.string().optional(),
  electric_phone: z.string().optional(),
  gas_provider: z.string().optional(),
  gas_account_number: z.string().optional(),
  gas_phone: z.string().optional(),
  water_provider: z.string().optional(),
  water_account_number: z.string().optional(),
  water_phone: z.string().optional(),
  internet_provider: z.string().optional(),
  internet_account_number: z.string().optional(),
  internet_phone: z.string().optional(),
}).strict();

export type BuildingProfileInput = z.infer<typeof buildingProfileSchema>;

// ─── Communication Settings ──────────────────────────────────────────────────

export const communicationSettingsSchema = z.object({
  visiting_hours_start: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  visiting_hours_end: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  visitor_check_in_required: z.boolean().optional(),
  visitor_screening_enabled: z.boolean().optional(),
  restricted_areas: z.array(z.string()).optional(),
  auto_notify_incident_types: z.array(z.string()).optional(),
  care_plan_update_notifications: z.boolean().optional(),
  photo_sharing_enabled: z.boolean().optional(),
  message_approval_required: z.boolean().optional(),
  google_business_profile_url: z.string().url().optional(),
  yelp_listing_url: z.string().url().optional(),
  caring_com_profile_url: z.string().url().optional(),
  facebook_page_url: z.string().url().optional(),
  facility_tagline: z.string().optional(),
  key_differentiators: z.array(z.string()).optional(),
  tour_available_days: z.array(z.string()).optional(),
  tour_available_hours_start: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  tour_available_hours_end: z.string().regex(/^\d{2}:\d{2}$/).optional(),
}).strict();

export type CommunicationSettingsInput = z.infer<typeof communicationSettingsSchema>;

// ─── Operational Thresholds ──────────────────────────────────────────────────

export const thresholdSchema = z.object({
  threshold_type: z.enum(THRESHOLD_TYPES),
  yellow_threshold: z.number().min(0),
  red_threshold: z.number().min(0),
  notify_roles: z.array(z.string()).min(1),
  enabled: z.boolean().default(true),
}).strict();

export type ThresholdInput = z.infer<typeof thresholdSchema>;

// ─── Timeline Event ──────────────────────────────────────────────────────────

export const timelineEventSchema = z.object({
  event_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  event_type: z.enum(TIMELINE_EVENT_TYPES),
  title: z.string().min(3),
  description: z.string().optional(),
  document_id: z.string().uuid().optional(),
}).strict();

export type TimelineEventInput = z.infer<typeof timelineEventSchema>;

// ─── Audit Log Query ─────────────────────────────────────────────────────────

export const auditLogQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(50),
  field_name: z.string().optional(),
  user_id: z.string().uuid().optional(),
  table_name: z.string().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;
