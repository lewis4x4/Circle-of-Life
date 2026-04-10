/**
 * Facility Admin Portal — Constants & Enums
 * Source: blueprint-col-facility-admin-portal-2026-04-10
 * All values must match CHECK constraints in migration 131
 */

// ─── Contact Categories ──────────────────────────────────────────────────────

export const CONTACT_CATEGORIES = [
  'law_enforcement', 'fire_department', 'hospital', 'poison_control',
  'utility_electric', 'utility_water', 'utility_gas', 'utility_internet',
  'ahca_hotline', 'ombudsman', 'dcf_abuse_hotline', 'osha',
  'evacuation_partner', 'corporate_on_call', 'facility_on_call',
  'pharmacy_after_hours', 'elevator_service', 'fire_alarm_monitoring',
  'generator_service', 'hvac_emergency', 'plumbing_emergency',
  'locksmith', 'county_emergency_mgmt', 'county_health_dept',
  'county_bldg_zoning', 'city_government', 'gas_provider',
  'electric_maintenance', 'roofing', 'painter', 'transport', 'other',
] as const;

export type ContactCategory = (typeof CONTACT_CATEGORIES)[number];

export const CONTACT_CATEGORY_LABELS: Record<ContactCategory, string> = {
  law_enforcement: 'Law Enforcement',
  fire_department: 'Fire Department',
  hospital: 'Hospital / Clinic',
  poison_control: 'Poison Control',
  utility_electric: 'Electric Utility',
  utility_water: 'Water Utility',
  utility_gas: 'Gas Utility',
  utility_internet: 'Internet Provider',
  ahca_hotline: 'AHCA Hotline',
  ombudsman: 'LTC Ombudsman',
  dcf_abuse_hotline: 'DCF / Elder Abuse Hotline',
  osha: 'OSHA',
  evacuation_partner: 'Evacuation Partner',
  corporate_on_call: 'Corporate On-Call',
  facility_on_call: 'Facility On-Call',
  pharmacy_after_hours: 'Pharmacy (After Hours)',
  elevator_service: 'Elevator Service',
  fire_alarm_monitoring: 'Fire Alarm Monitoring',
  generator_service: 'Generator Service',
  hvac_emergency: 'HVAC Emergency',
  plumbing_emergency: 'Plumbing Emergency',
  locksmith: 'Locksmith',
  county_emergency_mgmt: 'County Emergency Management',
  county_health_dept: 'County Health Dept',
  county_bldg_zoning: 'County Building & Zoning',
  city_government: 'City Government',
  gas_provider: 'Gas Provider',
  electric_maintenance: 'Electrical Contractor',
  roofing: 'Roofing',
  painter: 'Painter',
  transport: 'Transport Vendor',
  other: 'Other',
};

// ─── Document Categories ─────────────────────────────────────────────────────

export const DOCUMENT_CATEGORIES = [
  'ahca_license', 'fire_inspection', 'elevator_inspection',
  'kitchen_license', 'insurance_certificate', 'survey_report',
  'poc_response', 'resident_handbook', 'employee_handbook',
  'building_permit', 'occupancy_certificate', 'generator_inspection',
  'backflow_prevention', 'fire_alarm_inspection', 'sprinkler_inspection',
  'pest_control_report', 'water_quality_report', 'radon_test',
  'ada_compliance', 'evacuation_plan', 'floor_plan',
  'photo_hero', 'photo_room', 'photo_dining', 'photo_activity',
  'vendor_contract', 'storm_preparedness', 'other',
] as const;

export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export const DOCUMENT_CATEGORY_LABELS: Record<DocumentCategory, string> = {
  ahca_license: 'AHCA License',
  fire_inspection: 'Fire Inspection',
  elevator_inspection: 'Elevator Inspection',
  kitchen_license: 'Kitchen License',
  insurance_certificate: 'Insurance Certificate',
  survey_report: 'Survey Report',
  poc_response: 'POC Response',
  resident_handbook: 'Resident Handbook',
  employee_handbook: 'Employee Handbook',
  building_permit: 'Building Permit',
  occupancy_certificate: 'Occupancy Certificate',
  generator_inspection: 'Generator Inspection',
  backflow_prevention: 'Backflow Prevention',
  fire_alarm_inspection: 'Fire Alarm Inspection',
  sprinkler_inspection: 'Sprinkler Inspection',
  pest_control_report: 'Pest Control Report',
  water_quality_report: 'Water Quality Report',
  radon_test: 'Radon Test',
  ada_compliance: 'ADA Compliance',
  evacuation_plan: 'Evacuation Plan',
  floor_plan: 'Floor Plan',
  photo_hero: 'Photo — Hero',
  photo_room: 'Photo — Room',
  photo_dining: 'Photo — Dining',
  photo_activity: 'Photo — Activity',
  vendor_contract: 'Vendor Contract',
  storm_preparedness: 'Storm Preparedness',
  other: 'Other',
};

// ─── Rate Types ──────────────────────────────────────────────────────────────

export const RATE_TYPES = [
  'private_room', 'semi_private_room', 'respite_daily',
  'second_occupant', 'community_fee', 'admission_fee',
  'pet_fee_monthly', 'medicaid_oss', 'enhanced_alf_surcharge',
  'care_surcharge_level_1', 'care_surcharge_level_2', 'care_surcharge_level_3',
  'bed_hold_daily',
] as const;

export type RateType = (typeof RATE_TYPES)[number];

export const RATE_TYPE_LABELS: Record<RateType, string> = {
  private_room: 'Private Room (Monthly)',
  semi_private_room: 'Semi-Private Room (Monthly)',
  respite_daily: 'Respite (Daily)',
  second_occupant: 'Second Occupant (Monthly)',
  community_fee: 'Community Fee (One-Time)',
  admission_fee: 'Admission Fee (One-Time)',
  pet_fee_monthly: 'Pet Fee (Monthly)',
  medicaid_oss: 'Medicaid OSS Rate',
  enhanced_alf_surcharge: 'Enhanced ALF Services Surcharge',
  care_surcharge_level_1: 'Care Surcharge — Level 1',
  care_surcharge_level_2: 'Care Surcharge — Level 2',
  care_surcharge_level_3: 'Care Surcharge — Level 3',
  bed_hold_daily: 'Bed Hold (Daily)',
};

// ─── Threshold Types ─────────────────────────────────────────────────────────

export const THRESHOLD_TYPES = [
  'occupancy_low_pct', 'occupancy_high_pct',
  'staffing_ratio_violation', 'license_expiry_days',
  'insurance_expiry_days', 'document_expiry_days',
  'background_check_expiry_days', 'training_overdue_days',
  'fire_drill_overdue_days', 'elopement_drill_overdue_days',
  'incident_spike_count', 'census_change_alert',
] as const;

export type ThresholdType = (typeof THRESHOLD_TYPES)[number];

export const THRESHOLD_TYPE_LABELS: Record<ThresholdType, string> = {
  occupancy_low_pct: 'Occupancy Below %',
  occupancy_high_pct: 'Occupancy Above %',
  staffing_ratio_violation: 'Staffing Ratio Violation',
  license_expiry_days: 'License Expiring (days)',
  insurance_expiry_days: 'Insurance Expiring (days)',
  document_expiry_days: 'Document Expiring (days)',
  background_check_expiry_days: 'Background Check Expiring (days)',
  training_overdue_days: 'Training Overdue (days)',
  fire_drill_overdue_days: 'Fire Drill Overdue (days)',
  elopement_drill_overdue_days: 'Elopement Drill Overdue (days)',
  incident_spike_count: 'Incident Spike (count/week)',
  census_change_alert: 'Census Change (beds/day)',
};

// ─── Survey Types ────────────────────────────────────────────────────────────

export const SURVEY_TYPES = [
  'annual', 'complaint', 'follow_up', 'change_of_ownership', 'initial', 'abbreviated',
] as const;

export type SurveyType = (typeof SURVEY_TYPES)[number];

export const SURVEY_RESULTS = [
  'no_citations', 'citations_issued', 'immediate_jeopardy', 'conditional',
] as const;

export type SurveyResult = (typeof SURVEY_RESULTS)[number];

// ─── Timeline Event Types ────────────────────────────────────────────────────

export const TIMELINE_EVENT_TYPES = [
  'opened', 'ownership_change', 'administrator_change', 'renovation',
  'survey', 'license_renewal', 'insurance_renewal', 'capacity_change',
  'vendor_change', 'rate_change', 'policy_change', 'incident_major',
  'recognition', 'other',
] as const;

export type TimelineEventType = (typeof TIMELINE_EVENT_TYPES)[number];

// ─── Care Services ───────────────────────────────────────────────────────────
// CRITICAL: Never include 'memory_care' — COL uses 'enhanced_alf_services'

export const CARE_SERVICES = [
  'standard_alf', 'enhanced_alf_services', 'respite_care', 'adult_day_services',
] as const;

export type CareService = (typeof CARE_SERVICES)[number];

export const CARE_SERVICE_LABELS: Record<CareService, string> = {
  standard_alf: 'Standard ALF',
  enhanced_alf_services: 'Enhanced ALF Services',
  respite_care: 'Respite Care',
  adult_day_services: 'Adult Day Services',
};

// ─── Building Profile Enums ──────────────────────────────────────────────────

export const CONSTRUCTION_TYPES = [
  'wood_frame', 'masonry', 'steel_frame', 'concrete', 'mixed',
] as const;

export const FIRE_SUPPRESSION_TYPES = [
  'full_sprinkler', 'partial_sprinkler', 'extinguisher_only', 'none',
] as const;

export const GENERATOR_FUEL_TYPES = [
  'diesel', 'natural_gas', 'propane', 'dual_fuel',
] as const;

// ─── Facility Admin Portal Tabs ──────────────────────────────────────────────

export const FACILITY_TABS = [
  'overview', 'licensing', 'rates', 'building', 'emergency',
  'vendors', 'documents', 'staffing', 'communication',
  'thresholds', 'audit', 'timeline',
] as const;

export type FacilityTab = (typeof FACILITY_TABS)[number];

export const FACILITY_TAB_LABELS: Record<FacilityTab, string> = {
  overview: 'Overview',
  licensing: 'Licensing & Compliance',
  rates: 'Rates & Billing',
  building: 'Building & Safety',
  emergency: 'Emergency Contacts',
  vendors: 'Vendors',
  documents: 'Document Vault',
  staffing: 'Staffing Config',
  communication: 'Communication',
  thresholds: 'Alert Thresholds',
  audit: 'Audit Log',
  timeline: 'Timeline',
};

// ─── Compliance Contacts (FL hardcoded) ──────────────────────────────────────

export const FL_COMPLIANCE_CONTACTS = {
  state_survey: '800-962-2873',
  ltc_ombudsman: '888-831-0404',
  elder_abuse: '800-962-2873',
  disability_rights_fl: '800-342-0823',
  osha: '800-321-6742',
} as const;

// ─── Allowed MIME types for document uploads ─────────────────────────────────

export const ALLOWED_DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
] as const;

export const MAX_DOCUMENT_SIZE_BYTES = 26_214_400; // 25MB
