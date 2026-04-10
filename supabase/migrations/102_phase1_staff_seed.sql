-- Phase 1 Foundation Item 2: Staff Table Seed Data
-- Source: Section 3 of COL Technical Handoff
--
-- This migration:
-- - Extends staff_role enum with COL-specific roles
-- - Seeds 20 staff records (10 corporate leadership + 10 facility administrators)
-- - Corporate staff have facility_id = NULL
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
-- facility_id is NULL for CORPORATE level staff
-- organization_id references '00000000-0000-0000-0000-000000000001' (Circle of Life)
-- created_by uses system UUID for initial seed

INSERT INTO staff (facility_id, organization_id, first_name, last_name, phone, staff_role, employment_status, hire_date, created_by) VALUES
(NULL, '00000000-0000-0000-0000-000000000001', 'Milton', 'Smith', '386-984-0798', 'owner', 'active', '2014-01-01', '00000000-0000-0000-0000-000000000001'),
(NULL, '00000000-0000-0000-0000-000000000001', 'Darren', 'Webb', '850-443-2367', 'ceo', 'active', '2014-01-01', '00000000-0000-0000-0000-000000000001'),
(NULL, '00000000-0000-0000-0000-000000000001', 'Michelle', 'Norris', '386-209-1440', 'coo', 'active', '2014-01-01', '00000000-0000-0000-0000-000000000001'),
(NULL, '00000000-0000-0000-0000-000000000001', 'Jessica', 'Murphy', '386-688-9318', 'cfo', 'active', '2014-01-01', '00000000-0000-0000-0000-000000000001'),
(NULL, '00000000-0000-0000-0000-000000000001', 'Jessica', 'Lawson', '386-688-3589', 'admin_support_coordinator', 'active', '2014-01-01', '00000000-0000-0000-0000-000000000001'),
(NULL, '00000000-0000-0000-0000-000000000001', 'Todd', 'Denmark', '386-288-1372', 'marketing_consultant', 'active', '2014-01-01', '00000000-0000-0000-0000-000000000001'),
(NULL, '00000000-0000-0000-0000-000000000001', 'April', 'Powell', '386-867-5909', 'marketing_consultant', 'active', '2014-01-01', '00000000-0000-0000-0000-000000000001'),
(NULL, '00000000-0000-0000-0000-000000000001', 'Terrill', 'Murphy', '386-688-9318', 'maintenance_director', 'active', '2014-01-01', '00000000-0000-0000-0000-000000000001'),
(NULL, '00000000-0000-0000-0000-000000000001', 'Scott', 'Reeves', '386-288-6593', 'maintenance', 'active', '2014-01-01', '00000000-0000-0000-0000-000000000001'),
(NULL, '00000000-0000-0000-0000-000000000001', 'Richard', 'Rehberg', '386-292-0806', 'maintenance_standby', 'active', '2014-01-01', '00000000-0000-0000-0000-000000000001');

-- ============================================================
-- FACILITY ADMINISTRATORS
-- ============================================================

-- Source: Section 3 "Facility administrators"
-- Using facility UUIDs from seed migration 008_seed_col_organization.sql

-- Plantation ALF
INSERT INTO staff (facility_id, organization_id, first_name, last_name, phone, staff_role, employment_status, hire_date, created_by) VALUES
('00000000-0000-0000-0002-000000000004', '00000000-0000-0000-0000-000000000001', 'Bobbi Jo', 'Hare', '386-438-4775', 'administrator', 'active', '2015-01-01', '00000000-0000-0000-0000-000000000001'),
('00000000-0000-0000-0002-000000000004', '00000000-0000-0000-0000-000000000001', 'Sandy', 'Rehberg', '386-324-1139', 'assistant_administrator', 'active', '2015-01-01', '00000000-0000-0000-0000-000000000001');

-- Oakridge ALF
INSERT INTO staff (facility_id, organization_id, first_name, last_name, phone, staff_role, employment_status, hire_date, created_by) VALUES
('00000000-0000-0000-0002-000000000001', '00000000-0000-0000-0000-000000000001', 'Sulma', 'Estrada', '386-365-7242', 'administrator', 'active', '2014-01-01', '00000000-0000-0000-0000-000000000001'),
('00000000-0000-0000-0002-000000000001', '00000000-0000-0000-0000-000000000001', 'Mindy', 'Gaskins', '352-552-4388', 'assistant_administrator', 'active', '2014-01-01', '00000000-0000-0000-0000-000000000001');

-- Homewood Lodge ALF
INSERT INTO staff (facility_id, organization_id, first_name, last_name, phone, staff_role, employment_status, hire_date, created_by) VALUES
('00000000-0000-0000-0002-000000000003', '00000000-0000-0000-0000-000000000001', 'Jackie', 'Ramirez', '352-210-8789', 'administrator', 'active', '2014-01-01', '00000000-0000-0000-0000-000000000001'),
('00000000-0000-0000-0002-000000000003', '00000000-0000-0000-0000-000000000001', 'Charlene', 'Elmore', '386-688-4437', 'assistant_administrator', 'active', '2014-01-01', '00000000-0000-0000-0000-000000000001');

-- Rising Oaks ALF
INSERT INTO staff (facility_id, organization_id, first_name, last_name, phone, staff_role, employment_status, hire_date, created_by) VALUES
('00000000-0000-0000-0002-000000000002', '00000000-0000-0000-0000-000000000001', 'Crystal', 'Ducksworth', '352-210-2999', 'administrator', 'active', '2015-01-01', '00000000-0000-0000-0000-000000000001'),
('00000000-0000-0000-0002-000000000002', '00000000-0000-0000-0000-000000000001', 'Robin', 'Ducksworth', '352-538-9283', 'assistant_administrator', 'active', '2015-01-01', '00000000-0000-0000-0000-000000000001');

-- Grande Cypress ALF
INSERT INTO staff (facility_id, organization_id, first_name, last_name, phone, staff_role, employment_status, hire_date, created_by) VALUES
('00000000-0000-0000-0002-000000000005', '00000000-0000-0000-0000-000000000001', 'Jennifer', 'Smith', '386-365-4050', 'administrator', 'active', '2020-01-01', '00000000-0000-0000-0000-000000000001'),
('00000000-0000-0000-0002-000000000005', '00000000-0000-0000-0000-000000000001', 'Lori', 'Brown', '386-628-8756', 'assistant_administrator', 'active', '2020-01-01', '00000000-0000-0000-0000-000000000001');

-- ============================================================
-- TRIGGER UPDATES
-- ============================================================

-- The triggers for staff table already exist in 025_staff_management_audit_triggers.sql
-- No additional trigger creation needed

COMMENT ON TABLE staff IS 'Staff records including corporate leadership and facility administrators. Seed data from COL Technical Handoff Section 3.';
