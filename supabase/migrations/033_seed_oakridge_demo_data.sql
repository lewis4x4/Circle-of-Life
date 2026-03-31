-- Realistic demo data for Oakridge ALF — populates every UI screen.
-- Safe to re-run: uses ON CONFLICT DO NOTHING.
-- Uses fixed UUIDs for cross-reference stability.

-- ============================================================
-- 0. Constants
-- ============================================================
-- Organization:  00000000-0000-0000-0000-000000000001  (Circle of Life)
-- Entity:        00000000-0000-0000-0001-000000000001  (Pine House Inc / Oakridge)
-- Facility:      00000000-0000-0000-0002-000000000001  (Oakridge ALF)

-- ============================================================
-- 1. Auth users (email / password = demo@haven.local / HavenDemo2026!)
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

DO $$
DECLARE
  pw text := extensions.crypt('HavenDemo2026!', extensions.gen_salt('bf'));
  inst uuid := '00000000-0000-0000-0000-000000000000';
  ts  timestamptz := now();
BEGIN
  -- owner / admin
  INSERT INTO auth.users (id, instance_id, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, aud, role, created_at, updated_at, confirmation_token)
  VALUES
    ('a0000000-0000-0000-0000-000000000001', inst, 'milton@circleoflife.demo', pw, ts,
     '{"provider":"email","providers":["email"]}', '{"full_name":"Milton Smith"}',
     'authenticated','authenticated', ts, ts, ''),
    ('a0000000-0000-0000-0000-000000000002', inst, 'jessica@circleoflife.demo', pw, ts,
     '{"provider":"email","providers":["email"]}', '{"full_name":"Jessica Murphy"}',
     'authenticated','authenticated', ts, ts, ''),
    ('a0000000-0000-0000-0000-000000000003', inst, 'sarah.williams@circleoflife.demo', pw, ts,
     '{"provider":"email","providers":["email"]}', '{"full_name":"Sarah Williams"}',
     'authenticated','authenticated', ts, ts, ''),
    ('a0000000-0000-0000-0000-000000000004', inst, 'maria.garcia@circleoflife.demo', pw, ts,
     '{"provider":"email","providers":["email"]}', '{"full_name":"Maria Garcia"}',
     'authenticated','authenticated', ts, ts, ''),
    ('a0000000-0000-0000-0000-000000000005', inst, 'james.thompson@circleoflife.demo', pw, ts,
     '{"provider":"email","providers":["email"]}', '{"full_name":"James Thompson"}',
     'authenticated','authenticated', ts, ts, ''),
    ('a0000000-0000-0000-0000-000000000006', inst, 'robert.sullivan@family.demo', pw, ts,
     '{"provider":"email","providers":["email"]}', '{"full_name":"Robert Sullivan"}',
     'authenticated','authenticated', ts, ts, ''),
    ('a0000000-0000-0000-0000-000000000007', inst, 'linda.chen@family.demo', pw, ts,
     '{"provider":"email","providers":["email"]}', '{"full_name":"Linda Chen"}',
     'authenticated','authenticated', ts, ts, '')
  ON CONFLICT (id) DO NOTHING;

  -- identities (required for Supabase auth sign-in)
  INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
  VALUES
    (gen_random_uuid(), 'a0000000-0000-0000-0000-000000000001',
     '{"sub":"a0000000-0000-0000-0000-000000000001","email":"milton@circleoflife.demo"}',
     'email','a0000000-0000-0000-0000-000000000001', ts, ts, ts),
    (gen_random_uuid(), 'a0000000-0000-0000-0000-000000000002',
     '{"sub":"a0000000-0000-0000-0000-000000000002","email":"jessica@circleoflife.demo"}',
     'email','a0000000-0000-0000-0000-000000000002', ts, ts, ts),
    (gen_random_uuid(), 'a0000000-0000-0000-0000-000000000003',
     '{"sub":"a0000000-0000-0000-0000-000000000003","email":"sarah.williams@circleoflife.demo"}',
     'email','a0000000-0000-0000-0000-000000000003', ts, ts, ts),
    (gen_random_uuid(), 'a0000000-0000-0000-0000-000000000004',
     '{"sub":"a0000000-0000-0000-0000-000000000004","email":"maria.garcia@circleoflife.demo"}',
     'email','a0000000-0000-0000-0000-000000000004', ts, ts, ts),
    (gen_random_uuid(), 'a0000000-0000-0000-0000-000000000005',
     '{"sub":"a0000000-0000-0000-0000-000000000005","email":"james.thompson@circleoflife.demo"}',
     'email','a0000000-0000-0000-0000-000000000005', ts, ts, ts),
    (gen_random_uuid(), 'a0000000-0000-0000-0000-000000000006',
     '{"sub":"a0000000-0000-0000-0000-000000000006","email":"robert.sullivan@family.demo"}',
     'email','a0000000-0000-0000-0000-000000000006', ts, ts, ts),
    (gen_random_uuid(), 'a0000000-0000-0000-0000-000000000007',
     '{"sub":"a0000000-0000-0000-0000-000000000007","email":"linda.chen@family.demo"}',
     'email','a0000000-0000-0000-0000-000000000007', ts, ts, ts)
  ON CONFLICT DO NOTHING;
END $$;

-- ============================================================
-- 2. User profiles + RBAC
-- ============================================================
INSERT INTO user_profiles (id, organization_id, email, full_name, phone, app_role) VALUES
  ('a0000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','milton@circleoflife.demo','Milton Smith','386-339-1634','owner'),
  ('a0000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','jessica@circleoflife.demo','Jessica Murphy','386-339-1635','facility_admin'),
  ('a0000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001','sarah.williams@circleoflife.demo','Sarah Williams','386-339-1636','nurse'),
  ('a0000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000001','maria.garcia@circleoflife.demo','Maria Garcia','386-339-1637','caregiver'),
  ('a0000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000001','james.thompson@circleoflife.demo','James Thompson','386-339-1638','caregiver'),
  ('a0000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000001','robert.sullivan@family.demo','Robert Sullivan','386-555-0101','family'),
  ('a0000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000001','linda.chen@family.demo','Linda Chen','386-555-0102','family')
ON CONFLICT (id) DO NOTHING;

-- Facility access for staff
INSERT INTO user_facility_access (id, user_id, facility_id, organization_id, is_primary) VALUES
  ('f0000000-fa00-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001', true),
  ('f0000000-fa00-0000-0000-000000000002','a0000000-0000-0000-0000-000000000002','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001', true),
  ('f0000000-fa00-0000-0000-000000000003','a0000000-0000-0000-0000-000000000003','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001', true),
  ('f0000000-fa00-0000-0000-000000000004','a0000000-0000-0000-0000-000000000004','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001', true),
  ('f0000000-fa00-0000-0000-000000000005','a0000000-0000-0000-0000-000000000005','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001', true)
ON CONFLICT DO NOTHING;

-- ============================================================
-- 3. Units, rooms, beds
-- ============================================================
INSERT INTO units (id, facility_id, organization_id, name, floor_number, sort_order) VALUES
  ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','Wing A — Main',1,1),
  ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','Wing B — Extended Care',1,2)
ON CONFLICT (id) DO NOTHING;

INSERT INTO rooms (id, facility_id, organization_id, unit_id, room_number, room_type, max_occupancy, is_ada_accessible, near_nursing_station) VALUES
  ('d0000000-0000-0000-0000-000000000101','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','101','private',1,true,true),
  ('d0000000-0000-0000-0000-000000000102','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','102','private',1,false,false),
  ('d0000000-0000-0000-0000-000000000103','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','103','semi_private',2,false,false),
  ('d0000000-0000-0000-0000-000000000104','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','104','private',1,true,false),
  ('d0000000-0000-0000-0000-000000000201','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','201','private',1,true,true),
  ('d0000000-0000-0000-0000-000000000202','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','202','private',1,false,false),
  ('d0000000-0000-0000-0000-000000000203','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','203','semi_private',2,false,false),
  ('d0000000-0000-0000-0000-000000000204','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','204','private',1,true,true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO beds (id, room_id, facility_id, organization_id, bed_label, bed_type, status) VALUES
  ('b0000000-0000-0000-0000-000000000101','d0000000-0000-0000-0000-000000000101','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','101-A','alf_intermediate','occupied'),
  ('b0000000-0000-0000-0000-000000000102','d0000000-0000-0000-0000-000000000102','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','102-A','alf_intermediate','occupied'),
  ('b0000000-0000-0000-0000-000000000103','d0000000-0000-0000-0000-000000000103','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','103-A','alf_intermediate','occupied'),
  ('b0000000-0000-0000-0000-000000000104','d0000000-0000-0000-0000-000000000104','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','104-A','alf_intermediate','occupied'),
  ('b0000000-0000-0000-0000-000000000201','d0000000-0000-0000-0000-000000000201','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','201-A','alf_intermediate','occupied'),
  ('b0000000-0000-0000-0000-000000000202','d0000000-0000-0000-0000-000000000202','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','202-A','alf_intermediate','occupied'),
  ('b0000000-0000-0000-0000-000000000203','d0000000-0000-0000-0000-000000000203','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','203-A','alf_intermediate','occupied'),
  ('b0000000-0000-0000-0000-000000000204','d0000000-0000-0000-0000-000000000204','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','204-A','alf_intermediate','hold')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 4. Residents (8 — realistic ALF demographics)
-- ============================================================
INSERT INTO residents (id, facility_id, organization_id, bed_id, first_name, last_name, preferred_name, date_of_birth, gender, ssn_last_four, status, acuity_level, admission_date, primary_physician_name, primary_physician_phone, primary_diagnosis, diagnosis_list, allergy_list, diet_order, code_status, ambulatory, assistive_device, fall_risk_level, elopement_risk, wandering_risk, primary_payer, monthly_base_rate, monthly_care_surcharge, monthly_total_rate, rate_effective_date, responsible_party_name, responsible_party_relationship, responsible_party_phone, emergency_contact_1_name, emergency_contact_1_relationship, emergency_contact_1_phone, preferred_wake_time, preferred_bed_time) VALUES
  ('c0000000-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000101',
   'Margaret','Sullivan','Maggie','1943-06-15','female','4821','active','level_3','2024-03-01',
   'Dr. Patricia Hayes','386-755-1122','Alzheimer''s disease, early onset',
   ARRAY['Alzheimer''s disease','Hypertension','Osteoporosis','Type 2 Diabetes'],
   ARRAY['Penicillin','Sulfa drugs'],'Diabetic, mechanical soft','full_code',
   true,'Rollator walker','high',false,true,'private_pay',
   425000,75000,500000,'2024-03-01',
   'Robert Sullivan','Son','386-555-0101',
   'Robert Sullivan','Son','386-555-0101','07:00','20:30'),

  ('c0000000-0000-0000-0000-000000000002','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000102',
   'Harold','Chen',NULL,'1947-09-22','male','7193','active','level_2','2023-11-15',
   'Dr. Michael Rivera','386-755-2233','COPD',
   ARRAY['COPD','Atrial fibrillation','Chronic kidney disease stage 3'],
   ARRAY['Codeine'],'Regular, low sodium','full_code',
   true,'Cane','moderate',false,false,'ltc_insurance',
   425000,35000,460000,'2023-11-15',
   'Linda Chen','Daughter','386-555-0102',
   'Linda Chen','Daughter','386-555-0102','06:30','21:00'),

  ('c0000000-0000-0000-0000-000000000003','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000103',
   'Dorothy','Williams','Dot','1940-02-08','female','3345','active','level_2','2024-01-10',
   'Dr. Patricia Hayes','386-755-1122','Vascular dementia',
   ARRAY['Vascular dementia','Hypothyroidism','Anxiety disorder','Osteoarthritis'],
   ARRAY[]::text[],'Regular, pureed','dnr',
   true,'Wheelchair (short distances)','high',false,true,'medicaid_oss',
   425000,35000,460000,'2024-01-10',
   'Karen Williams','Daughter','386-555-0103',
   'Karen Williams','Daughter','386-555-0103','07:30','20:00'),

  ('c0000000-0000-0000-0000-000000000004','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000104',
   'Arthur','Pennington','Art','1949-11-30','male','5567','active','level_1','2024-06-01',
   'Dr. James Crawford','386-755-3344','Essential hypertension',
   ARRAY['Essential hypertension','Benign prostatic hyperplasia','Mild cognitive impairment'],
   ARRAY['Aspirin'],'Regular','full_code',
   true,NULL,'standard',false,false,'private_pay',
   425000,0,425000,'2024-06-01',
   'Thomas Pennington','Son','386-555-0104',
   'Thomas Pennington','Son','386-555-0104','06:00','22:00'),

  ('c0000000-0000-0000-0000-000000000005','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000201',
   'Ruth','Anderson',NULL,'1935-04-19','female','8912','active','level_3','2023-08-20',
   'Dr. Michael Rivera','386-755-2233','Parkinson''s disease',
   ARRAY['Parkinson''s disease','Depression','Recurrent UTI','Dysphagia'],
   ARRAY['Latex','Ibuprofen'],'Mechanical soft, thickened liquids','full_code',
   false,'Wheelchair','high',true,false,'private_pay',
   425000,75000,500000,'2023-08-20',
   'Diane Anderson','Daughter','386-555-0105',
   'Diane Anderson','Daughter','386-555-0105','07:00','19:30'),

  ('c0000000-0000-0000-0000-000000000006','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000202',
   'Frank','Martinez',NULL,'1953-07-04','male','2234','active','level_1','2025-01-15',
   'Dr. James Crawford','386-755-3344','Type 2 Diabetes',
   ARRAY['Type 2 Diabetes','Peripheral neuropathy','Depression'],
   ARRAY[]::text[],'Diabetic','full_code',
   true,NULL,'standard',false,false,'va_aid_attendance',
   425000,0,425000,'2025-01-15',
   'Carmen Martinez','Wife','386-555-0106',
   'Carmen Martinez','Wife','386-555-0106','06:30','21:30'),

  ('c0000000-0000-0000-0000-000000000007','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000203',
   'Virginia','Taylor','Ginny','1937-12-25','female','6678','active','level_2','2024-09-01',
   'Dr. Patricia Hayes','386-755-1122','Congestive heart failure',
   ARRAY['CHF','Atrial fibrillation','Macular degeneration','Osteoporosis'],
   ARRAY['ACE inhibitors'],'Low sodium, regular','full_code',
   true,'Rollator walker','moderate',false,false,'private_pay',
   425000,35000,460000,'2024-09-01',
   'Mark Taylor','Son','386-555-0107',
   'Mark Taylor','Son','386-555-0107','07:00','20:00'),

  ('c0000000-0000-0000-0000-000000000008','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000204',
   'Walter','Brown','Walt','1944-08-10','male','9901','hospital_hold','level_2','2024-04-15',
   'Dr. Michael Rivera','386-755-2233','COPD exacerbation',
   ARRAY['COPD','Coronary artery disease','GERD','Chronic pain'],
   ARRAY['Morphine'],'Regular','full_code',
   true,'Cane','moderate',false,false,'private_pay',
   425000,35000,460000,'2024-04-15',
   'Susan Brown','Wife','386-555-0108',
   'Susan Brown','Wife','386-555-0108','07:00','21:00')
ON CONFLICT (id) DO NOTHING;

-- Link beds to residents
UPDATE beds SET current_resident_id = 'c0000000-0000-0000-0000-000000000001' WHERE id = 'b0000000-0000-0000-0000-000000000101';
UPDATE beds SET current_resident_id = 'c0000000-0000-0000-0000-000000000002' WHERE id = 'b0000000-0000-0000-0000-000000000102';
UPDATE beds SET current_resident_id = 'c0000000-0000-0000-0000-000000000003' WHERE id = 'b0000000-0000-0000-0000-000000000103';
UPDATE beds SET current_resident_id = 'c0000000-0000-0000-0000-000000000004' WHERE id = 'b0000000-0000-0000-0000-000000000104';
UPDATE beds SET current_resident_id = 'c0000000-0000-0000-0000-000000000005' WHERE id = 'b0000000-0000-0000-0000-000000000201';
UPDATE beds SET current_resident_id = 'c0000000-0000-0000-0000-000000000006' WHERE id = 'b0000000-0000-0000-0000-000000000202';
UPDATE beds SET current_resident_id = 'c0000000-0000-0000-0000-000000000007' WHERE id = 'b0000000-0000-0000-0000-000000000203';
UPDATE beds SET current_resident_id = 'c0000000-0000-0000-0000-000000000008' WHERE id = 'b0000000-0000-0000-0000-000000000204';

-- ============================================================
-- 5. Family–resident links
-- ============================================================
INSERT INTO family_resident_links (id, user_id, resident_id, organization_id, relationship, is_responsible_party, is_emergency_contact, can_view_clinical, can_view_financial) VALUES
  ('e0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000006','c0000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','Son',true,true,true,true),
  ('e0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000007','c0000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','Daughter',true,true,true,true)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 6. Staff records
-- ============================================================
INSERT INTO staff (id, user_id, facility_id, organization_id, first_name, last_name, phone, email, staff_role, employment_status, hire_date, hourly_rate, is_full_time) VALUES
  ('50000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','Jessica','Murphy','386-339-1635','jessica@circleoflife.demo','administrator','active','2014-03-01',3500,true),
  ('50000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000003','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','Sarah','Williams','386-339-1636','sarah.williams@circleoflife.demo','lpn','active','2020-06-15',2800,true),
  ('50000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000004','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','Maria','Garcia','386-339-1637','maria.garcia@circleoflife.demo','cna','active','2022-01-10',1600,true),
  ('50000000-0000-0000-0000-000000000004','a0000000-0000-0000-0000-000000000005','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','James','Thompson','386-339-1638','james.thompson@circleoflife.demo','cna','active','2023-04-01',1600,true),
  ('50000000-0000-0000-0000-000000000005',NULL,'00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','Angela','Davis','386-339-1639','angela@circleoflife.demo','activities_director','active','2019-09-01',2200,true),
  ('50000000-0000-0000-0000-000000000006',NULL,'00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','Robert','Jackson','386-339-1640','robert.j@circleoflife.demo','dietary_manager','active','2021-02-01',2000,true)
ON CONFLICT (id) DO NOTHING;

-- Staff certifications
INSERT INTO staff_certifications (id, staff_id, facility_id, organization_id, certification_type, certification_name, issuing_authority, certificate_number, issue_date, expiration_date, status) VALUES
  ('51000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000002','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','lpn_license','Licensed Practical Nurse','Florida Board of Nursing','LPN-2020-4455','2020-06-01','2026-06-01','active'),
  ('51000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000002','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','cpr_bls','CPR/BLS Provider','American Heart Association','BLS-88123','2025-01-15','2027-01-15','active'),
  ('51000000-0000-0000-0000-000000000003','50000000-0000-0000-0000-000000000003','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','cna_certification','Certified Nursing Assistant','Florida DOEA','CNA-2022-0010','2022-01-10','2024-01-10','expired'),
  ('51000000-0000-0000-0000-000000000004','50000000-0000-0000-0000-000000000003','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','cpr_bls','CPR/BLS Provider','American Heart Association','BLS-88456','2025-03-01','2027-03-01','active'),
  ('51000000-0000-0000-0000-000000000005','50000000-0000-0000-0000-000000000004','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','cna_certification','Certified Nursing Assistant','Florida DOEA','CNA-2023-0055','2023-04-01','2025-04-01','pending_renewal'),
  ('51000000-0000-0000-0000-000000000006','50000000-0000-0000-0000-000000000005','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','activities_certification','Certified Activities Director','NCCAP','CAD-2019-112','2019-09-01','2025-09-01','active'),
  ('51000000-0000-0000-0000-000000000007','50000000-0000-0000-0000-000000000006','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','food_safety','ServSafe Food Handler','National Restaurant Association','SS-2021-7890','2021-02-01','2026-02-01','active')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 7. Care plans + items
-- ============================================================
INSERT INTO care_plans (id, resident_id, facility_id, organization_id, version, status, effective_date, review_due_date, notes) VALUES
  ('60000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001',1,'active','2024-03-15','2026-06-15','Initial comprehensive care plan for Margaret. High fall risk, Alzheimer''s, diabetes management.'),
  ('60000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-000000000002','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001',1,'active','2023-12-01','2026-06-01','COPD management with cardiac monitoring.'),
  ('60000000-0000-0000-0000-000000000003','c0000000-0000-0000-0000-000000000003','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001',1,'active','2024-01-20','2026-04-20','Dementia care with wandering prevention.'),
  ('60000000-0000-0000-0000-000000000004','c0000000-0000-0000-0000-000000000005','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001',1,'active','2023-09-01','2026-03-01','Parkinson''s focused with elopement risk management.'),
  ('60000000-0000-0000-0000-000000000005','c0000000-0000-0000-0000-000000000007','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001',1,'under_review','2024-09-15','2026-03-15','CHF management; review triggered by recent weight gain.')
ON CONFLICT (id) DO NOTHING;

INSERT INTO care_plan_items (id, care_plan_id, resident_id, facility_id, organization_id, category, title, description, assistance_level, frequency, goal, interventions, sort_order) VALUES
  ('61000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','fall_prevention','Fall Prevention Protocol','High fall risk due to gait instability and Alzheimer''s. Bed alarm active. 2-hour rounding required.','extensive_assist','Every 2 hours','Zero falls during quarter',ARRAY['Bed alarm at all times','Non-skid footwear','Clear pathways','2-hour rounding checks','Assist with all transfers'],1),
  ('61000000-0000-0000-0000-000000000002','60000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','medication_assistance','Blood Sugar Monitoring','Fingerstick glucose checks AC and HS. Sliding scale insulin per physician orders.','extensive_assist','QID (before meals + bedtime)','HbA1c < 7.5',ARRAY['Fingerstick AC and HS','Record in eMAR','Notify nurse if > 300 or < 70','Ensure meal consumption within 30 min of insulin'],2),
  ('61000000-0000-0000-0000-000000000003','60000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','bathing','Bathing Assistance','Requires full assistance with shower. Prefers evening showers on Tue/Thu/Sat.','extensive_assist','3x weekly','Maintain skin integrity and dignity',ARRAY['Shower chair','Handheld showerhead','Check water temperature','Inspect skin during bathing'],3),
  ('61000000-0000-0000-0000-000000000004','60000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','cognitive','Cognitive Stimulation','Alzheimer''s: redirect gently, use simple instructions, familiar routines.','limited_assist','Daily','Maintain current cognitive function; minimize agitation',ARRAY['Reminiscence activities','Simple puzzles and sorting','Music therapy','Consistent daily routine'],4),
  ('61000000-0000-0000-0000-000000000005','60000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-000000000002','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','medication_assistance','COPD Respiratory Management','Scheduled nebulizer treatments and O2 saturation monitoring.','limited_assist','BID + PRN','O2 sat > 92% consistently',ARRAY['Nebulizer treatments 08:00 and 20:00','Monitor O2 sat each shift','Incentive spirometry encouragement','Elevate HOB 30 degrees'],1),
  ('61000000-0000-0000-0000-000000000006','60000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-000000000002','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','mobility','Cardiac Activity Tolerance','Monitor activity tolerance. Rest periods between activities.','supervision','Daily','Tolerate 15-min walks without distress',ARRAY['Monitor HR and O2 during ambulation','Seated rest every 10 min','Report dyspnea or chest pain immediately'],2),
  ('61000000-0000-0000-0000-000000000007','60000000-0000-0000-0000-000000000003','c0000000-0000-0000-0000-000000000003','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','fall_prevention','Wandering Risk Management','Frequent wandering attempts, especially late afternoon. Door alarms active.','extensive_assist','Continuous','Prevent unsupervised exit from facility',ARRAY['WanderGuard bracelet active','Door alarms checked each shift','1:1 during sundowning hours (15:00–18:00)','Redirect to safe areas'],1),
  ('61000000-0000-0000-0000-000000000008','60000000-0000-0000-0000-000000000004','c0000000-0000-0000-0000-000000000005','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','mobility','Parkinson''s Mobility Program','Progressive rigidity and bradykinesia. PT exercises 3x/week.','extensive_assist','3x weekly','Maintain current mobility level',ARRAY['Assist with all transfers','Wide-base gait training','PT exercises Mon/Wed/Fri','Time medications to optimize mobility windows'],1),
  ('61000000-0000-0000-0000-000000000009','60000000-0000-0000-0000-000000000005','c0000000-0000-0000-0000-000000000007','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','dietary','CHF Fluid and Sodium Management','Daily weights, fluid restriction 1500ml, low sodium diet.','limited_assist','Daily','Weight stable within 2 lb range',ARRAY['Daily weight at 06:00 before breakfast','Record all fluid intake','Low-sodium meal plan','Report weight gain > 2 lbs in 24 hrs'],1)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 8. Medications
-- ============================================================
INSERT INTO resident_medications (id, resident_id, facility_id, organization_id, medication_name, generic_name, strength, form, route, frequency, scheduled_times, instructions, indication, prescriber_name, status, start_date, order_date) VALUES
  ('70000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','Aricept','Donepezil','10mg','Tablet','oral','daily',ARRAY['20:00']::time[],'Take at bedtime with water','Alzheimer''s disease','Dr. Patricia Hayes','active','2024-03-01','2024-03-01'),
  ('70000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','Metformin','Metformin HCl','500mg','Tablet','oral','bid',ARRAY['08:00','18:00']::time[],'Take with meals','Type 2 Diabetes','Dr. Patricia Hayes','active','2024-03-01','2024-03-01'),
  ('70000000-0000-0000-0000-000000000003','c0000000-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','Lisinopril','Lisinopril','10mg','Tablet','oral','daily',ARRAY['08:00']::time[],'Take in the morning','Hypertension','Dr. Patricia Hayes','active','2024-03-01','2024-03-01'),
  ('70000000-0000-0000-0000-000000000004','c0000000-0000-0000-0000-000000000002','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','Spiriva','Tiotropium','18mcg','Inhalation Capsule','inhaled','daily',ARRAY['08:00']::time[],'Use HandiHaler device, rinse mouth after','COPD maintenance','Dr. Michael Rivera','active','2023-11-15','2023-11-15'),
  ('70000000-0000-0000-0000-000000000005','c0000000-0000-0000-0000-000000000002','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','Eliquis','Apixaban','5mg','Tablet','oral','bid',ARRAY['08:00','20:00']::time[],'Take with or without food','Atrial fibrillation','Dr. Michael Rivera','active','2023-11-15','2023-11-15'),
  ('70000000-0000-0000-0000-000000000006','c0000000-0000-0000-0000-000000000005','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','Sinemet','Carbidopa/Levodopa','25/100mg','Tablet','oral','tid',ARRAY['07:00','13:00','19:00']::time[],'Take 30 min before meals','Parkinson''s disease','Dr. Michael Rivera','active','2023-08-20','2023-08-20'),
  ('70000000-0000-0000-0000-000000000007','c0000000-0000-0000-0000-000000000007','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','Lasix','Furosemide','40mg','Tablet','oral','daily',ARRAY['08:00']::time[],'Take in the morning; monitor weight daily','CHF','Dr. Patricia Hayes','active','2024-09-01','2024-09-01'),
  ('70000000-0000-0000-0000-000000000008','c0000000-0000-0000-0000-000000000007','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','Coreg','Carvedilol','12.5mg','Tablet','oral','bid',ARRAY['08:00','20:00']::time[],'Take with food; check HR before giving','CHF / Atrial fibrillation','Dr. Patricia Hayes','active','2024-09-01','2024-09-01')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 9. Daily logs + ADL logs (recent 3 days)
-- ============================================================
INSERT INTO daily_logs (id, resident_id, facility_id, organization_id, log_date, shift, logged_by, general_notes, mood, temperature, blood_pressure_systolic, blood_pressure_diastolic, pulse, oxygen_saturation) VALUES
  ('80000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001',CURRENT_DATE,'day','a0000000-0000-0000-0000-000000000004','Good morning. Maggie ate 75% of breakfast. Ambulated to dining room with walker, steady gait. Participated in morning group activity.','Content',98.2,138,82,76,97.5),
  ('80000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-000000000002','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001',CURRENT_DATE,'day','a0000000-0000-0000-0000-000000000004','Harold resting comfortably. O2 sat 94% on room air. Used incentive spirometer x10 with encouragement.','Calm',98.6,128,78,72,94.0),
  ('80000000-0000-0000-0000-000000000003','c0000000-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001',CURRENT_DATE - 1,'day','a0000000-0000-0000-0000-000000000005','Maggie had a restless night per night shift notes. Slightly confused at breakfast but oriented after redirection. Blood sugar 142 AC breakfast.','Anxious',98.4,142,86,78,97.0),
  ('80000000-0000-0000-0000-000000000004','c0000000-0000-0000-0000-000000000005','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001',CURRENT_DATE,'day','a0000000-0000-0000-0000-000000000005','Ruth participated in seated exercise class. Tremor moderate today. Ate 60% lunch with adaptive utensils.','Pleasant',98.0,118,70,68,96.5),
  ('80000000-0000-0000-0000-000000000005','c0000000-0000-0000-0000-000000000007','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001',CURRENT_DATE,'day','a0000000-0000-0000-0000-000000000004','Ginny''s weight 148.2 lbs (up 1.4 lbs from yesterday). Fluid intake being monitored closely. Slight ankle edema noted bilateral.','Tired',98.4,134,80,82,95.0),
  ('80000000-0000-0000-0000-000000000006','c0000000-0000-0000-0000-000000000003','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001',CURRENT_DATE,'day','a0000000-0000-0000-0000-000000000005','Dorothy attempted to exit through side door at 10:15. Redirected to activities room. Ate pureed lunch 80%. Calm after lunch.','Restless',98.0,130,76,74,97.0)
ON CONFLICT (id) DO NOTHING;

INSERT INTO adl_logs (id, resident_id, facility_id, organization_id, daily_log_id, log_date, shift, logged_by, adl_type, assistance_level, notes) VALUES
  ('81000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000001',CURRENT_DATE,'day','a0000000-0000-0000-0000-000000000004','bathing','extensive_assist','Shower completed with shower chair. Skin intact, no breakdown noted.'),
  ('81000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000001',CURRENT_DATE,'day','a0000000-0000-0000-0000-000000000004','dressing','limited_assist','Chose own clothing; needed help with buttons and shoes.'),
  ('81000000-0000-0000-0000-000000000003','c0000000-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000001',CURRENT_DATE,'day','a0000000-0000-0000-0000-000000000004','toileting','limited_assist','Continent. Reminded to use call light; complied.'),
  ('81000000-0000-0000-0000-000000000004','c0000000-0000-0000-0000-000000000002','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000002',CURRENT_DATE,'day','a0000000-0000-0000-0000-000000000004','mobility','supervision','Ambulated 200 ft in hallway with cane. No SOB noted.'),
  ('81000000-0000-0000-0000-000000000005','c0000000-0000-0000-0000-000000000005','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000004',CURRENT_DATE,'day','a0000000-0000-0000-0000-000000000005','eating','extensive_assist','Used adaptive utensils, moderate hand tremor. Needed cueing to continue eating.')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 10. Activities + sessions (upcoming and past)
-- ============================================================
INSERT INTO activities (id, facility_id, organization_id, name, description, default_day_of_week, default_start_time, default_duration_minutes, facilitator, is_recurring) VALUES
  ('ac000000-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','Morning Exercise','Seated stretching and light range-of-motion exercises',ARRAY[1,2,3,4,5],'09:00',45,'Angela Davis',true),
  ('ac000000-0000-0000-0000-000000000002','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','Bingo','Weekly bingo with prizes',ARRAY[3],'14:00',60,'Angela Davis',true),
  ('ac000000-0000-0000-0000-000000000003','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','Music Therapy','Live guitar and sing-along session',ARRAY[2,4],'15:00',45,'Volunteer — Carol',true),
  ('ac000000-0000-0000-0000-000000000004','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','Art Class','Watercolor painting and crafts',ARRAY[5],'10:00',60,'Angela Davis',true),
  ('ac000000-0000-0000-0000-000000000005','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','Movie Afternoon','Classic film screening in community room',ARRAY[6],'14:00',120,'Staff on duty',true),
  ('ac000000-0000-0000-0000-000000000006','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','Family Visitation Day','Open visitation with refreshments',ARRAY[0],'13:00',180,'Jessica Murphy',true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO activity_sessions (id, activity_id, facility_id, organization_id, session_date, start_time, end_time, facilitator_name, cancelled) VALUES
  ('a5000000-0000-0000-0000-000000000001','ac000000-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001',CURRENT_DATE,     (CURRENT_DATE + '09:00'::time)::timestamptz,(CURRENT_DATE + '09:45'::time)::timestamptz,'Angela Davis',false),
  ('a5000000-0000-0000-0000-000000000002','ac000000-0000-0000-0000-000000000002','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001',CURRENT_DATE + 1, (CURRENT_DATE + 1 + '14:00'::time)::timestamptz,(CURRENT_DATE + 1 + '15:00'::time)::timestamptz,'Angela Davis',false),
  ('a5000000-0000-0000-0000-000000000003','ac000000-0000-0000-0000-000000000003','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001',CURRENT_DATE + 2, (CURRENT_DATE + 2 + '15:00'::time)::timestamptz,(CURRENT_DATE + 2 + '15:45'::time)::timestamptz,'Volunteer — Carol',false),
  ('a5000000-0000-0000-0000-000000000004','ac000000-0000-0000-0000-000000000004','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001',CURRENT_DATE + 3, (CURRENT_DATE + 3 + '10:00'::time)::timestamptz,(CURRENT_DATE + 3 + '11:00'::time)::timestamptz,'Angela Davis',false),
  ('a5000000-0000-0000-0000-000000000005','ac000000-0000-0000-0000-000000000005','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001',CURRENT_DATE + 4, (CURRENT_DATE + 4 + '14:00'::time)::timestamptz,(CURRENT_DATE + 4 + '16:00'::time)::timestamptz,'Staff on duty',false),
  ('a5000000-0000-0000-0000-000000000006','ac000000-0000-0000-0000-000000000006','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001',CURRENT_DATE + 5, (CURRENT_DATE + 5 + '13:00'::time)::timestamptz,(CURRENT_DATE + 5 + '16:00'::time)::timestamptz,'Jessica Murphy',false),
  ('a5000000-0000-0000-0000-000000000007','ac000000-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001',CURRENT_DATE + 7, (CURRENT_DATE + 7 + '09:00'::time)::timestamptz,(CURRENT_DATE + 7 + '09:45'::time)::timestamptz,'Angela Davis',false),
  ('a5000000-0000-0000-0000-000000000008','ac000000-0000-0000-0000-000000000003','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001',CURRENT_DATE - 1, (CURRENT_DATE - 1 + '15:00'::time)::timestamptz,(CURRENT_DATE - 1 + '15:45'::time)::timestamptz,'Volunteer — Carol',false),
  ('a5000000-0000-0000-0000-000000000009','ac000000-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001',CURRENT_DATE - 2, (CURRENT_DATE - 2 + '09:00'::time)::timestamptz,(CURRENT_DATE - 2 + '09:45'::time)::timestamptz,'Angela Davis',true)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 11. Incidents (2 recent)
-- ============================================================
INSERT INTO incidents (id, resident_id, facility_id, organization_id, incident_number, category, severity, status, occurred_at, discovered_at, shift, location_description, description, immediate_actions, contributing_factors, fall_witnessed, injury_occurred, reported_by, nurse_notified, nurse_notified_at, administrator_notified, family_notified, family_notified_at) VALUES
  ('90000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001',
   'OAK-2026-0001','fall_without_injury','level_2','resolved',
   now() - interval '5 days', now() - interval '5 days','day',
   'Room 101 — between bed and bathroom',
   'Resident found on floor beside bed. States she was trying to reach bathroom without using call light. No injury noted. Bed alarm was active but resident moved quickly.',
   'Assisted resident to standing position. Vitals checked: BP 130/78, HR 74, oriented x2. Nurse notified. Incident report filed.',
   ARRAY['Alzheimer''s — impaired judgment','Did not use call light','Rushed movement'],
   false,false,'a0000000-0000-0000-0000-000000000004',
   true, now() - interval '5 days',true,true, now() - interval '5 days'),

  ('90000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-000000000003','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001',
   'OAK-2026-0002','wandering','level_2','investigating',
   now() - interval '2 days', now() - interval '2 days','evening',
   'Side exit door — Wing A',
   'Resident attempted to leave facility through side emergency exit at approximately 16:30. Door alarm sounded. Staff redirected resident back to common area. Resident was confused, stated she was "going home to cook dinner."',
   'Resident redirected to activities room. Given a snack and engaged in folding towels activity. WanderGuard bracelet verified functional. Extra 1:1 check schedule implemented for sundowning hours.',
   ARRAY['Sundowning behavior','Vascular dementia','Late afternoon timing'],
   NULL,false,'a0000000-0000-0000-0000-000000000005',
   true, now() - interval '2 days',true,true, now() - interval '2 days')
ON CONFLICT (id) DO NOTHING;

INSERT INTO incident_followups (id, incident_id, resident_id, facility_id, organization_id, task_type, description, due_at, assigned_to) VALUES
  ('91000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','care_plan_review','Review and update fall prevention protocol in care plan','2026-04-05T12:00:00Z','a0000000-0000-0000-0000-000000000003'),
  ('91000000-0000-0000-0000-000000000002','90000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-000000000003','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','door_alarm_audit','Verify all exterior door alarms functional and WanderGuard system check','2026-04-02T12:00:00Z','a0000000-0000-0000-0000-000000000002'),
  ('91000000-0000-0000-0000-000000000003','90000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-000000000003','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','staffing_review','Evaluate staffing levels during sundowning hours (15:00–18:00)','2026-04-03T12:00:00Z','a0000000-0000-0000-0000-000000000002')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 12. Behavioral logs + condition changes
-- ============================================================
INSERT INTO behavioral_logs (id, resident_id, facility_id, organization_id, occurred_at, shift, logged_by, antecedent, behavior, behavior_type, consequence, intervention_used, intervention_effective, duration_minutes, notes) VALUES
  ('b1000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001',now() - interval '1 day','evening','a0000000-0000-0000-0000-000000000005','Unfamiliar evening caregiver entered room','Verbal agitation, refusing to take evening medications','verbal_agitation','Caregiver stepped out. Familiar staff member (Maria) administered medications successfully.', ARRAY['Familiar staff substitution','Calm verbal redirection','Brief time-out'],true,15,'Alzheimer''s-related sundowning. Resolved with familiar face.'),
  ('b1000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-000000000003','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001',now() - interval '3 days','day','a0000000-0000-0000-0000-000000000004','Lunch served late due to dietary staff shortage','Became upset, pushed food tray off table','physical_agitation','Staff cleaned area, offered fresh tray 10 min later. Resident ate 70%.', ARRAY['Environmental modification','Meal replacement','1:1 attention'],true,10,'Routine disruption triggers agitation. Document for care plan review.')
ON CONFLICT (id) DO NOTHING;

INSERT INTO condition_changes (id, resident_id, facility_id, organization_id, reported_at, reported_by, shift, change_type, description, severity, nurse_notified, nurse_notified_at, physician_notified, family_notified) VALUES
  ('cc000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000007','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001',now() - interval '1 day','a0000000-0000-0000-0000-000000000004','day','weight_gain','Weight up 1.4 lbs from yesterday (148.2 vs 146.8). Bilateral ankle edema 1+ noted. Fluid intake tracking initiated.','moderate',true,now() - interval '1 day',false,false),
  ('cc000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-000000000002','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001',now() - interval '2 days','a0000000-0000-0000-0000-000000000005','day','respiratory','O2 sat dropped to 89% during morning ambulation. Returned to baseline 94% after 5 min rest and supplemental O2 2L NC.','moderate',true,now() - interval '2 days',true,true)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 13. Shift handoff
-- ============================================================
INSERT INTO shift_handoffs (id, facility_id, organization_id, handoff_date, outgoing_shift, incoming_shift, outgoing_staff_id, outgoing_notes, auto_summary) VALUES
  ('b2000000-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001',CURRENT_DATE,'day','evening','a0000000-0000-0000-0000-000000000004',
   'Margaret: Blood sugar 142 at breakfast, 168 at lunch. Walker compliance good today. Dorothy: Attempted exit at 10:15, redirected successfully. 1:1 during sundowning recommended. Harold: O2 stable at 94%. Nebulizer treatments completed on time. Ginny: Weight up 1.4 lbs — nurse aware, monitoring fluid intake. Ruth: Good day, participated in exercise class. Tremor moderate.',
   '{"residents_with_alerts":["c0000000-0000-0000-0000-000000000001","c0000000-0000-0000-0000-000000000003","c0000000-0000-0000-0000-000000000007"],"pending_followups":2,"prn_given":0}')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 14. Rate schedule + invoices + payments
-- ============================================================
INSERT INTO rate_schedules (id, facility_id, organization_id, name, effective_date, base_rate_private, base_rate_semi_private, care_surcharge_level_1, care_surcharge_level_2, care_surcharge_level_3, community_fee, respite_daily_rate) VALUES
  ('b3000000-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','2025 Standard Rate Schedule','2025-01-01',425000,375000,0,35000,75000,250000,17500)
ON CONFLICT (id) DO NOTHING;

INSERT INTO resident_payers (id, resident_id, facility_id, organization_id, payer_type, is_primary, payer_name, effective_date) VALUES
  ('b4000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','private_pay',true,'Robert Sullivan','2024-03-01'),
  ('b4000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-000000000002','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','ltc_insurance',true,'Genworth Life Insurance','2023-11-15'),
  ('b4000000-0000-0000-0000-000000000003','c0000000-0000-0000-0000-000000000003','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','medicaid_oss',true,'Florida Medicaid','2024-01-10'),
  ('b4000000-0000-0000-0000-000000000004','c0000000-0000-0000-0000-000000000005','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','private_pay',true,'Diane Anderson','2023-08-20')
ON CONFLICT (id) DO NOTHING;

INSERT INTO invoices (id, resident_id, facility_id, organization_id, entity_id, invoice_number, invoice_date, due_date, period_start, period_end, status, subtotal, total, amount_paid, balance_due) VALUES
  ('b5000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0001-000000000001','OAK-2026-03-001','2026-03-01','2026-03-15','2026-03-01','2026-03-31','paid',500000,500000,500000,0),
  ('b5000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-000000000002','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0001-000000000001','OAK-2026-03-002','2026-03-01','2026-03-15','2026-03-01','2026-03-31','sent',460000,460000,0,460000),
  ('b5000000-0000-0000-0000-000000000003','c0000000-0000-0000-0000-000000000005','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0001-000000000001','OAK-2026-03-003','2026-03-01','2026-03-15','2026-03-01','2026-03-31','partial',500000,500000,350000,150000),
  ('b5000000-0000-0000-0000-000000000004','c0000000-0000-0000-0000-000000000007','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0001-000000000001','OAK-2026-03-004','2026-03-01','2026-03-15','2026-03-01','2026-03-31','overdue',460000,460000,0,460000)
ON CONFLICT (id) DO NOTHING;

INSERT INTO invoice_line_items (id, invoice_id, organization_id, line_type, description, quantity, unit_price, total, sort_order) VALUES
  ('b6000000-0000-0000-0000-000000000001','b5000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','room_and_board','Private Room — Monthly Rate',1,425000,425000,1),
  ('b6000000-0000-0000-0000-000000000002','b5000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','care_surcharge','Level 3 Care Surcharge',1,75000,75000,2),
  ('b6000000-0000-0000-0000-000000000003','b5000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','room_and_board','Private Room — Monthly Rate',1,425000,425000,1),
  ('b6000000-0000-0000-0000-000000000004','b5000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','care_surcharge','Level 2 Care Surcharge',1,35000,35000,2),
  ('b6000000-0000-0000-0000-000000000005','b5000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001','room_and_board','Private Room — Monthly Rate',1,425000,425000,1),
  ('b6000000-0000-0000-0000-000000000006','b5000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001','care_surcharge','Level 3 Care Surcharge',1,75000,75000,2),
  ('b6000000-0000-0000-0000-000000000007','b5000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000001','room_and_board','Private Room — Monthly Rate',1,425000,425000,1),
  ('b6000000-0000-0000-0000-000000000008','b5000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000001','care_surcharge','Level 2 Care Surcharge',1,35000,35000,2)
ON CONFLICT (id) DO NOTHING;

INSERT INTO payments (id, resident_id, facility_id, organization_id, entity_id, invoice_id, payment_date, amount, payment_method, reference_number, payer_name) VALUES
  ('b7000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0001-000000000001','b5000000-0000-0000-0000-000000000001','2026-03-10',500000,'check','1847','Robert Sullivan'),
  ('b7000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-000000000005','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0001-000000000001','b5000000-0000-0000-0000-000000000003','2026-03-12',350000,'ach','ACH-90214','Diane Anderson')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 15. Schedule + shift assignments + time records
-- ============================================================
INSERT INTO schedules (id, facility_id, organization_id, week_start_date, status, published_at) VALUES
  ('b8000000-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001', date_trunc('week', CURRENT_DATE)::date, 'published', now() - interval '3 days')
ON CONFLICT (id) DO NOTHING;

INSERT INTO shift_assignments (id, schedule_id, staff_id, facility_id, organization_id, shift_date, shift_type, unit_id, status) VALUES
  ('b9000000-0000-0000-0000-000000000001','b8000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000003','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001',CURRENT_DATE,'day','10000000-0000-0000-0000-000000000001','confirmed'),
  ('b9000000-0000-0000-0000-000000000002','b8000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000004','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001',CURRENT_DATE,'day','10000000-0000-0000-0000-000000000002','confirmed'),
  ('b9000000-0000-0000-0000-000000000003','b8000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000003','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001',CURRENT_DATE + 1,'day','10000000-0000-0000-0000-000000000001','assigned'),
  ('b9000000-0000-0000-0000-000000000004','b8000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000004','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001',CURRENT_DATE + 1,'evening','10000000-0000-0000-0000-000000000002','assigned'),
  ('b9000000-0000-0000-0000-000000000005','b8000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000002','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001',CURRENT_DATE,'day',NULL,'completed')
ON CONFLICT (id) DO NOTHING;

INSERT INTO time_records (id, staff_id, shift_assignment_id, facility_id, organization_id, clock_in, clock_out, clock_in_method, clock_out_method, scheduled_hours, actual_hours, regular_hours, approved) VALUES
  ('ba000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000003','b9000000-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001',(CURRENT_DATE + '06:55'::time)::timestamptz,(CURRENT_DATE + '15:05'::time)::timestamptz,'mobile_app','mobile_app',8.0,8.17,8.17,false),
  ('ba000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000004','b9000000-0000-0000-0000-000000000002','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001',(CURRENT_DATE + '07:00'::time)::timestamptz,(CURRENT_DATE + '15:02'::time)::timestamptz,'mobile_app','mobile_app',8.0,8.03,8.03,false),
  ('ba000000-0000-0000-0000-000000000003','50000000-0000-0000-0000-000000000002','b9000000-0000-0000-0000-000000000005','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001',(CURRENT_DATE + '06:50'::time)::timestamptz,(CURRENT_DATE + '15:10'::time)::timestamptz,'kiosk','kiosk',8.0,8.33,8.33,true)
ON CONFLICT (id) DO NOTHING;

-- Staffing ratio snapshot
INSERT INTO staffing_ratio_snapshots (id, facility_id, organization_id, shift, residents_present, staff_on_duty, ratio, required_ratio, is_compliant, staff_detail) VALUES
  ('bb000000-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','day',7,3,2.33,5.00,true,'[{"name":"Maria Garcia","role":"cna"},{"name":"James Thompson","role":"cna"},{"name":"Sarah Williams","role":"lpn"}]')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 16. Family portal messages
-- ============================================================
INSERT INTO family_portal_messages (id, organization_id, facility_id, resident_id, author_user_id, author_kind, body) VALUES
  ('fe000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000001','c0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000006','family','Hi, this is Robert. Just wanted to check — how did Mom do with her medications today? She mentioned feeling dizzy on our call yesterday.'),
  ('fe000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000001','c0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000003','staff','Hi Robert, Margaret took all her medications on time today. Her blood pressure was 138/82 this morning, which is within her normal range. The dizziness might be related to her new blood pressure medication — I''ll ask the doctor to review the dosage at her next visit. She had a good day overall, ate well, and participated in morning exercise.'),
  ('fe000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000001','c0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000006','family','Thank you so much, Sarah. That''s reassuring. I''ll be visiting this Sunday for the family visitation day. Is there anything I should bring?'),
  ('fe000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000001','c0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000007','family','Hello, I wanted to ask about Dad''s breathing. He sounded a bit winded on the phone this morning. Is everything okay?'),
  ('fe000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000001','c0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000004','staff','Hi Linda, Harold''s O2 saturation was 94% today on room air, which is his baseline. He did use his incentive spirometer well. He might have sounded winded from walking to the phone — we''re working on building his exercise tolerance gradually. His nebulizer treatments are on schedule.')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 17. Census daily log
-- ============================================================
INSERT INTO census_daily_log (id, facility_id, organization_id, log_date, total_licensed_beds, occupied_beds, available_beds, hold_beds, maintenance_beds, occupancy_rate) VALUES
  ('cd000000-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001',CURRENT_DATE,52,7,44,1,0,0.1346)
ON CONFLICT (id) DO NOTHING;
