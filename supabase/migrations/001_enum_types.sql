-- Haven foundation: enum types (spec 00-foundation.md)

CREATE TYPE org_status AS ENUM ('active', 'suspended', 'archived');
CREATE TYPE entity_status AS ENUM ('active', 'inactive', 'archived');
CREATE TYPE facility_status AS ENUM ('active', 'inactive', 'under_renovation', 'archived');

CREATE TYPE bed_status AS ENUM ('available', 'occupied', 'hold', 'maintenance', 'offline');
CREATE TYPE room_type AS ENUM ('private', 'semi_private', 'shared');
CREATE TYPE bed_type AS ENUM ('alf_intermediate', 'memory_care', 'independent_living');

CREATE TYPE resident_status AS ENUM (
  'inquiry',
  'pending_admission',
  'active',
  'hospital_hold',
  'loa',
  'discharged',
  'deceased'
);
CREATE TYPE gender AS ENUM ('male', 'female', 'other', 'prefer_not_to_say');
CREATE TYPE payer_type AS ENUM ('private_pay', 'medicaid_oss', 'ltc_insurance', 'va_aid_attendance', 'other');
CREATE TYPE acuity_level AS ENUM ('level_1', 'level_2', 'level_3');
CREATE TYPE discharge_reason AS ENUM (
  'higher_level_of_care',
  'hospital_permanent',
  'another_alf',
  'home',
  'death',
  'non_payment',
  'behavioral',
  'other'
);

CREATE TYPE staff_role AS ENUM (
  'cna',
  'lpn',
  'rn',
  'administrator',
  'activities_director',
  'dietary_staff',
  'dietary_manager',
  'maintenance',
  'housekeeping',
  'driver',
  'other'
);
CREATE TYPE employment_status AS ENUM ('active', 'on_leave', 'terminated', 'suspended');
CREATE TYPE shift_type AS ENUM ('day', 'evening', 'night', 'custom');

CREATE TYPE app_role AS ENUM (
  'owner',
  'org_admin',
  'facility_admin',
  'nurse',
  'caregiver',
  'dietary',
  'maintenance_role',
  'family',
  'broker'
);

CREATE TYPE incident_severity AS ENUM ('level_1', 'level_2', 'level_3', 'level_4');
CREATE TYPE incident_category AS ENUM (
  'fall_with_injury',
  'fall_without_injury',
  'fall_witnessed',
  'fall_unwitnessed',
  'elopement',
  'wandering',
  'medication_error',
  'medication_refusal',
  'skin_integrity',
  'pressure_injury',
  'unexplained_bruise',
  'behavioral_resident_to_resident',
  'behavioral_resident_to_staff',
  'behavioral_self_harm',
  'abuse_allegation',
  'neglect_allegation',
  'property_damage',
  'property_loss',
  'environmental_fire',
  'environmental_flood',
  'environmental_power',
  'environmental_pest',
  'infection',
  'other'
);
CREATE TYPE incident_status AS ENUM ('open', 'investigating', 'resolved', 'closed');

CREATE TYPE care_plan_status AS ENUM ('draft', 'active', 'under_review', 'archived');
CREATE TYPE care_plan_item_category AS ENUM (
  'mobility',
  'bathing',
  'dressing',
  'grooming',
  'toileting',
  'eating',
  'medication_assistance',
  'behavioral',
  'fall_prevention',
  'skin_integrity',
  'pain_management',
  'cognitive',
  'social',
  'dietary',
  'other'
);
CREATE TYPE assistance_level AS ENUM (
  'independent',
  'supervision',
  'limited_assist',
  'extensive_assist',
  'total_dependence'
);

CREATE TYPE medication_frequency AS ENUM (
  'daily',
  'bid',
  'tid',
  'qid',
  'qhs',
  'qam',
  'prn',
  'weekly',
  'biweekly',
  'monthly',
  'other'
);
CREATE TYPE medication_route AS ENUM (
  'oral',
  'sublingual',
  'topical',
  'ophthalmic',
  'otic',
  'nasal',
  'inhaled',
  'rectal',
  'transdermal',
  'subcutaneous',
  'intramuscular',
  'other'
);
CREATE TYPE medication_status AS ENUM ('active', 'discontinued', 'on_hold', 'completed');
CREATE TYPE emar_status AS ENUM ('scheduled', 'given', 'refused', 'held', 'not_available', 'self_administered');
CREATE TYPE controlled_schedule AS ENUM ('ii', 'iii', 'iv', 'v', 'non_controlled');

CREATE TYPE invoice_status AS ENUM (
  'draft',
  'sent',
  'paid',
  'partial',
  'overdue',
  'void',
  'written_off'
);
CREATE TYPE payment_method AS ENUM (
  'check',
  'ach',
  'credit_card',
  'cash',
  'medicaid_payment',
  'insurance_payment',
  'other'
);

CREATE TYPE certification_status AS ENUM ('active', 'expired', 'pending_renewal', 'revoked');

CREATE TYPE schedule_status AS ENUM ('draft', 'published', 'archived');
CREATE TYPE shift_assignment_status AS ENUM (
  'assigned',
  'confirmed',
  'swap_requested',
  'called_out',
  'no_show',
  'completed'
);
