-- Phase 1 Foundation Item 2: Staff Table Seed Data
-- Source: Section 3 of COL Technical Handoff
--
-- This migration:
-- - Extends staff_role enum with COL-specific roles
-- - Seeds 20 staff records (10 corporate leadership + 10 facility administrators)
-- - Corporate staff use the Oakridge (pilot) facility_id so rows satisfy
--   staff.facility_id NOT NULL (Module 11 schema); they remain org-level by organization_id.
--
-- Existing RLS policies and audit triggers remain unchanged

-- ============================================================
-- ENUM EXTENSION
-- ============================================================

-- Extend staff_role enum to include COL-specific roles from handoff
-- Source: Section 3 StaffRole enum

ALTER TYPE staff_role ADD VALUE IF NOT EXISTS 'owner';
ALTER TYPE staff_role ADD VALUE IF NOT EXISTS 'ceo';
ALTER TYPE staff_role ADD VALUE IF NOT EXISTS 'coo';
ALTER TYPE staff_role ADD VALUE IF NOT EXISTS 'cfo';
ALTER TYPE staff_role ADD VALUE IF NOT EXISTS 'assistant_administrator';
ALTER TYPE staff_role ADD VALUE IF NOT EXISTS 'admin_support_coordinator';
ALTER TYPE staff_role ADD VALUE IF NOT EXISTS 'marketing_consultant';
ALTER TYPE staff_role ADD VALUE IF NOT EXISTS 'maintenance_director';
ALTER TYPE staff_role ADD VALUE IF NOT EXISTS 'maintenance_standby';
ALTER TYPE staff_role ADD VALUE IF NOT EXISTS 'medication_tech';
ALTER TYPE staff_role ADD VALUE IF NOT EXISTS 'resident_aide';
ALTER TYPE staff_role ADD VALUE IF NOT EXISTS 'dietary_aide';
ALTER TYPE staff_role ADD VALUE IF NOT EXISTS 'activity_aide';
ALTER TYPE staff_role ADD VALUE IF NOT EXISTS 'resident_services_coordinator';

-- ============================================================
-- CORPORATE LEADERSHIP
-- ============================================================

-- Source: Section 3 "Corporate leadership"
-- Anchor to Oakridge ALF (pilot) for facility_id NOT NULL; organization_id remains COL org.
-- created_by uses org-placeholder auth id; Docker pg-verify seeds matching row in scripts/pg-verify-stub.sql

INSERT INTO staff (facility_id, organization_id, first_name, last_name, phone, staff_role, employment_status, hire_date, created_by) VALUES
('00000000-0000-0000-0002-000000000001', '00000000-0000-0000-0000-000000000001', 'Synthetic first_name fe4f74e910', 'Synthetic last_name 6627835f98', '202-555-0176', 'owner', 'active', '2014-01-01', '062c3cfb-53a5-4482-814a-cbef2b028760'),
('00000000-0000-0000-0002-000000000001', '00000000-0000-0000-0000-000000000001', 'Synthetic first_name 27223b8296', 'Synthetic last_name a64c4cd79a', '202-555-0153', 'ceo', 'active', '2014-01-01', '062c3cfb-53a5-4482-814a-cbef2b028760'),
('00000000-0000-0000-0002-000000000001', '00000000-0000-0000-0000-000000000001', 'Synthetic first_name 0162114830', 'Synthetic last_name 11d6fe94df', '202-555-0124', 'coo', 'active', '2014-01-01', '062c3cfb-53a5-4482-814a-cbef2b028760'),
('00000000-0000-0000-0002-000000000001', '00000000-0000-0000-0000-000000000001', 'Synthetic first_name e1fc45f788', 'Synthetic last_name ca700c8aa0', '202-555-0182', 'cfo', 'active', '2014-01-01', '062c3cfb-53a5-4482-814a-cbef2b028760'),
('00000000-0000-0000-0002-000000000001', '00000000-0000-0000-0000-000000000001', 'Synthetic first_name e1fc45f788', 'Synthetic last_name 4aa59b5a37', '202-555-0178', 'admin_support_coordinator', 'active', '2014-01-01', '062c3cfb-53a5-4482-814a-cbef2b028760'),
('00000000-0000-0000-0002-000000000001', '00000000-0000-0000-0000-000000000001', 'Synthetic first_name fb0f00141e', 'Synthetic last_name 5f0bf3ff6b', '202-555-0113', 'marketing_consultant', 'active', '2014-01-01', '062c3cfb-53a5-4482-814a-cbef2b028760'),
('00000000-0000-0000-0002-000000000001', '00000000-0000-0000-0000-000000000001', 'Synthetic first_name aa68908295', 'Synthetic last_name f4eb4544aa', '202-555-0139', 'marketing_consultant', 'active', '2014-01-01', '062c3cfb-53a5-4482-814a-cbef2b028760'),
('00000000-0000-0000-0002-000000000001', '00000000-0000-0000-0000-000000000001', 'Synthetic first_name 6ecfadffb4', 'Synthetic last_name ca700c8aa0', '202-555-0182', 'maintenance_director', 'active', '2014-01-01', '062c3cfb-53a5-4482-814a-cbef2b028760'),
('00000000-0000-0000-0002-000000000001', '00000000-0000-0000-0000-000000000001', 'Synthetic first_name 12a303c224', 'Synthetic last_name 82c74ecd82', '202-555-0136', 'maintenance', 'active', '2014-01-01', '062c3cfb-53a5-4482-814a-cbef2b028760'),
('00000000-0000-0000-0002-000000000001', '00000000-0000-0000-0000-000000000001', 'Synthetic first_name 61bffea921', 'Synthetic last_name f9072796b0', '202-555-0167', 'maintenance_standby', 'active', '2014-01-01', '062c3cfb-53a5-4482-814a-cbef2b028760');

-- ============================================================
-- FACILITY ADMINISTRATORS
-- ============================================================

-- Source: Section 3 "Facility administrators"
-- Using facility UUIDs from seed migration 008_seed_col_organization.sql

-- Plantation ALF
INSERT INTO staff (facility_id, organization_id, first_name, last_name, phone, staff_role, employment_status, hire_date, created_by) VALUES
('00000000-0000-0000-0002-000000000004', '00000000-0000-0000-0000-000000000001', 'Synthetic first_name 27b0c80888', 'Synthetic last_name e39f1cde9e', '202-555-0109', 'administrator', 'active', '2015-01-01', '062c3cfb-53a5-4482-814a-cbef2b028760'),
('00000000-0000-0000-0002-000000000004', '00000000-0000-0000-0000-000000000001', 'Synthetic first_name aec6e92008', 'Synthetic last_name f9072796b0', '202-555-0132', 'assistant_administrator', 'active', '2015-01-01', '062c3cfb-53a5-4482-814a-cbef2b028760');

-- Oakridge ALF
INSERT INTO staff (facility_id, organization_id, first_name, last_name, phone, staff_role, employment_status, hire_date, created_by) VALUES
('00000000-0000-0000-0002-000000000001', '00000000-0000-0000-0000-000000000001', 'Synthetic first_name 2281eff428', 'Synthetic last_name 878f7fc93e', '202-555-0198', 'administrator', 'active', '2014-01-01', '062c3cfb-53a5-4482-814a-cbef2b028760'),
('00000000-0000-0000-0002-000000000001', '00000000-0000-0000-0000-000000000001', 'Synthetic first_name 7376c22801', 'Synthetic last_name 6c1d84c88f', '202-555-0108', 'assistant_administrator', 'active', '2014-01-01', '062c3cfb-53a5-4482-814a-cbef2b028760');

-- Homewood Lodge ALF
INSERT INTO staff (facility_id, organization_id, first_name, last_name, phone, staff_role, employment_status, hire_date, created_by) VALUES
('00000000-0000-0000-0002-000000000003', '00000000-0000-0000-0000-000000000001', 'Synthetic first_name ae50ad81a2', 'Synthetic last_name 9f714d1e5a', '202-555-0197', 'administrator', 'active', '2014-01-01', '062c3cfb-53a5-4482-814a-cbef2b028760'),
('00000000-0000-0000-0002-000000000003', '00000000-0000-0000-0000-000000000001', 'Synthetic first_name 8962392173', 'Synthetic last_name 42cd302db7', '202-555-0122', 'assistant_administrator', 'active', '2014-01-01', '062c3cfb-53a5-4482-814a-cbef2b028760');

-- Rising Oaks ALF
INSERT INTO staff (facility_id, organization_id, first_name, last_name, phone, staff_role, employment_status, hire_date, created_by) VALUES
('00000000-0000-0000-0002-000000000002', '00000000-0000-0000-0000-000000000001', 'Synthetic first_name 60a0f78b50', 'Synthetic last_name 8b81d7c89e', '202-555-0136', 'administrator', 'active', '2015-01-01', '062c3cfb-53a5-4482-814a-cbef2b028760'),
('00000000-0000-0000-0002-000000000002', '00000000-0000-0000-0000-000000000001', 'Synthetic first_name 287782ef42', 'Synthetic last_name 8b81d7c89e', '202-555-0131', 'assistant_administrator', 'active', '2015-01-01', '062c3cfb-53a5-4482-814a-cbef2b028760');

-- Grande Cypress ALF
INSERT INTO staff (facility_id, organization_id, first_name, last_name, phone, staff_role, employment_status, hire_date, created_by) VALUES
('00000000-0000-0000-0002-000000000005', '00000000-0000-0000-0000-000000000001', 'Synthetic first_name 9ce8db922a', 'Synthetic last_name 6627835f98', '202-555-0164', 'administrator', 'active', '2020-01-01', '062c3cfb-53a5-4482-814a-cbef2b028760'),
('00000000-0000-0000-0002-000000000005', '00000000-0000-0000-0000-000000000001', 'Synthetic first_name 8096fbd699', 'Synthetic last_name 5eb67f9f84', '202-555-0138', 'assistant_administrator', 'active', '2020-01-01', '062c3cfb-53a5-4482-814a-cbef2b028760');

-- ============================================================
-- TRIGGER UPDATES
-- ============================================================

-- The triggers for staff table already exist in 025_staff_management_audit_triggers.sql
-- No additional trigger creation needed

COMMENT ON TABLE staff IS 'Staff records including corporate leadership and facility administrators. Seed data from COL Technical Handoff Section 3.';
