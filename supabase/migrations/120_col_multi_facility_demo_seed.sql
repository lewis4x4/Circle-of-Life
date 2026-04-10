-- Multi-facility demo seed for Circle of Life org (00000000-0000-0000-0000-000000000001).
-- Extends 033_seed_oakridge_demo_data.sql: same vertical slice per non-pilot facility (002–005).
-- Safe to re-run: ON CONFLICT DO NOTHING; fixed UUIDs per facility namespace (…0002…, …0003…, …0004…, …0005…).
--
-- Facilities (from 008_seed_col_organization.sql):
--   002 Rising Oaks   | entity …0001-000000000002
--   003 Homewood      | entity …0001-000000000003
--   004 Plantation    | entity …0001-000000000004
--   005 Grande Cypress| entity …0001-000000000005

-- =============================================================================
-- 0. Pilot users → access all COL facilities (facility selector / RLS)
-- =============================================================================
INSERT INTO user_facility_access (id, user_id, facility_id, organization_id, is_primary) VALUES
  ('f0000000-fa00-0000-0000-000000000201','a0000000-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000002','00000000-0000-0000-0000-000000000001', false),
  ('f0000000-fa00-0000-0000-000000000202','a0000000-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000003','00000000-0000-0000-0000-000000000001', false),
  ('f0000000-fa00-0000-0000-000000000203','a0000000-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000004','00000000-0000-0000-0000-000000000001', false),
  ('f0000000-fa00-0000-0000-000000000204','a0000000-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000005','00000000-0000-0000-0000-000000000001', false),
  ('f0000000-fa00-0000-0000-000000000205','a0000000-0000-0000-0000-000000000002','00000000-0000-0000-0002-000000000002','00000000-0000-0000-0000-000000000001', false),
  ('f0000000-fa00-0000-0000-000000000206','a0000000-0000-0000-0000-000000000002','00000000-0000-0000-0002-000000000003','00000000-0000-0000-0000-000000000001', false),
  ('f0000000-fa00-0000-0000-000000000207','a0000000-0000-0000-0000-000000000002','00000000-0000-0000-0002-000000000004','00000000-0000-0000-0000-000000000001', false),
  ('f0000000-fa00-0000-0000-000000000208','a0000000-0000-0000-0000-000000000002','00000000-0000-0000-0002-000000000005','00000000-0000-0000-0000-000000000001', false),
  ('f0000000-fa00-0000-0000-000000000209','a0000000-0000-0000-0000-000000000003','00000000-0000-0000-0002-000000000002','00000000-0000-0000-0000-000000000001', false),
  ('f0000000-fa00-0000-0000-00000000020a','a0000000-0000-0000-0000-000000000003','00000000-0000-0000-0002-000000000003','00000000-0000-0000-0000-000000000001', false),
  ('f0000000-fa00-0000-0000-00000000020b','a0000000-0000-0000-0000-000000000003','00000000-0000-0000-0002-000000000004','00000000-0000-0000-0000-000000000001', false),
  ('f0000000-fa00-0000-0000-00000000020c','a0000000-0000-0000-0000-000000000003','00000000-0000-0000-0002-000000000005','00000000-0000-0000-0000-000000000001', false),
  ('f0000000-fa00-0000-0000-00000000020d','a0000000-0000-0000-0000-000000000004','00000000-0000-0000-0002-000000000002','00000000-0000-0000-0000-000000000001', false),
  ('f0000000-fa00-0000-0000-00000000020e','a0000000-0000-0000-0000-000000000004','00000000-0000-0000-0002-000000000003','00000000-0000-0000-0000-000000000001', false),
  ('f0000000-fa00-0000-0000-00000000020f','a0000000-0000-0000-0000-000000000004','00000000-0000-0000-0002-000000000004','00000000-0000-0000-0000-000000000001', false),
  ('f0000000-fa00-0000-0000-000000000210','a0000000-0000-0000-0000-000000000004','00000000-0000-0000-0002-000000000005','00000000-0000-0000-0000-000000000001', false),
  ('f0000000-fa00-0000-0000-000000000211','a0000000-0000-0000-0000-000000000005','00000000-0000-0000-0002-000000000002','00000000-0000-0000-0000-000000000001', false),
  ('f0000000-fa00-0000-0000-000000000212','a0000000-0000-0000-0000-000000000005','00000000-0000-0000-0002-000000000003','00000000-0000-0000-0000-000000000001', false),
  ('f0000000-fa00-0000-0000-000000000213','a0000000-0000-0000-0000-000000000005','00000000-0000-0000-0002-000000000004','00000000-0000-0000-0000-000000000001', false),
  ('f0000000-fa00-0000-0000-000000000214','a0000000-0000-0000-0000-000000000005','00000000-0000-0000-0002-000000000005','00000000-0000-0000-0000-000000000001', false)
ON CONFLICT (user_id, facility_id) WHERE revoked_at IS NULL DO NOTHING;

-- =============================================================================
-- FACILITY 002 — Rising Oaks ALF
-- =============================================================================
INSERT INTO units (id, facility_id, organization_id, name, floor_number, sort_order) VALUES
  ('10000002-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000002','00000000-0000-0000-0000-000000000001','Main Wing',1,1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO rooms (id, facility_id, organization_id, unit_id, room_number, room_type, max_occupancy, is_ada_accessible, near_nursing_station) VALUES
  ('d0000002-0000-0000-0000-000000000101','00000000-0000-0000-0002-000000000002','00000000-0000-0000-0000-000000000001','10000002-0000-0000-0000-000000000001','A101','private',1,true,true),
  ('d0000002-0000-0000-0000-000000000102','00000000-0000-0000-0002-000000000002','00000000-0000-0000-0000-000000000001','10000002-0000-0000-0000-000000000001','A102','private',1,false,false),
  ('d0000002-0000-0000-0000-000000000103','00000000-0000-0000-0002-000000000002','00000000-0000-0000-0000-000000000001','10000002-0000-0000-0000-000000000001','A103','semi_private',2,false,false),
  ('d0000002-0000-0000-0000-000000000104','00000000-0000-0000-0002-000000000002','00000000-0000-0000-0000-000000000001','10000002-0000-0000-0000-000000000001','A104','private',1,true,false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO beds (id, room_id, facility_id, organization_id, bed_label, bed_type, status) VALUES
  ('b0000002-0000-0000-0000-000000000101','d0000002-0000-0000-0000-000000000101','00000000-0000-0000-0002-000000000002','00000000-0000-0000-0000-000000000001','A101-A','alf_intermediate','occupied'),
  ('b0000002-0000-0000-0000-000000000102','d0000002-0000-0000-0000-000000000102','00000000-0000-0000-0002-000000000002','00000000-0000-0000-0000-000000000001','A102-A','alf_intermediate','occupied'),
  ('b0000002-0000-0000-0000-000000000103','d0000002-0000-0000-0000-000000000103','00000000-0000-0000-0002-000000000002','00000000-0000-0000-0000-000000000001','A103-A','alf_intermediate','occupied'),
  ('b0000002-0000-0000-0000-000000000104','d0000002-0000-0000-0000-000000000104','00000000-0000-0000-0002-000000000002','00000000-0000-0000-0000-000000000001','A104-A','alf_intermediate','occupied')
ON CONFLICT (id) DO NOTHING;

INSERT INTO residents (id, facility_id, organization_id, bed_id, first_name, last_name, preferred_name, date_of_birth, gender, ssn_last_four, status, acuity_level, admission_date, primary_physician_name, primary_physician_phone, primary_diagnosis, diagnosis_list, allergy_list, diet_order, code_status, ambulatory, assistive_device, fall_risk_level, elopement_risk, wandering_risk, primary_payer, monthly_base_rate, monthly_care_surcharge, monthly_total_rate, rate_effective_date, responsible_party_name, responsible_party_relationship, responsible_party_phone, emergency_contact_1_name, emergency_contact_1_relationship, emergency_contact_1_phone, preferred_wake_time, preferred_bed_time) VALUES
  ('c0000002-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000002','00000000-0000-0000-0000-000000000001','b0000002-0000-0000-0000-000000000101','Alice','Rivers','Ali','1941-03-10','female','2211','active','level_2','2024-02-01','Dr. Hayes','386-755-1122','Hypertension',ARRAY['Hypertension','Osteoarthritis'],ARRAY[]::text[],'Regular','full_code',true,'Cane','moderate',false,false,'private_pay',425000,35000,460000,'2024-02-01','Paul Rivers','Son','386-555-0201','Paul Rivers','Son','386-555-0201','07:00','21:00'),
  ('c0000002-0000-0000-0000-000000000002','00000000-0000-0000-0002-000000000002','00000000-0000-0000-0000-000000000001','b0000002-0000-0000-0000-000000000102','Ben','Cross',NULL,'1946-07-22','male','3322','active','level_1','2023-09-15','Dr. Rivera','386-755-2233','Type 2 Diabetes',ARRAY['Type 2 DM'],ARRAY['Sulfa'],'Diabetic','full_code',true,NULL,'standard',false,false,'ltc_insurance',425000,0,425000,'2023-09-15','Ben Cross Jr','Son','386-555-0202','Ben Cross Jr','Son','386-555-0202','06:30','22:00'),
  ('c0000002-0000-0000-0000-000000000003','00000000-0000-0000-0002-000000000002','00000000-0000-0000-0000-000000000001','b0000002-0000-0000-0000-000000000103','Clara','Nguyen',NULL,'1939-11-05','female','4433','active','level_3','2024-05-20','Dr. Hayes','386-755-1122','Alzheimer''s disease',ARRAY['Alzheimer''s disease'],ARRAY['Penicillin'],'Mechanical soft','full_code',true,'Walker','high',false,true,'medicaid_oss',425000,75000,500000,'2024-05-20','Mai Nguyen','Daughter','386-555-0203','Mai Nguyen','Daughter','386-555-0203','07:30','20:00'),
  ('c0000002-0000-0000-0000-000000000004','00000000-0000-0000-0002-000000000002','00000000-0000-0000-0000-000000000001','b0000002-0000-0000-0000-000000000104','Doug','Walsh','Doug','1950-01-30','male','5544','active','level_1','2025-02-01','Dr. Crawford','386-755-3344','Osteoarthritis',ARRAY['OA'],ARRAY[]::text[],'Regular','full_code',true,NULL,'standard',false,false,'private_pay',425000,0,425000,'2025-02-01','Doug Walsh','Self','386-555-0204','Doug Walsh','Self','386-555-0204','06:00','22:30')
ON CONFLICT (id) DO NOTHING;

UPDATE beds SET current_resident_id = 'c0000002-0000-0000-0000-000000000001' WHERE id = 'b0000002-0000-0000-0000-000000000101';
UPDATE beds SET current_resident_id = 'c0000002-0000-0000-0000-000000000002' WHERE id = 'b0000002-0000-0000-0000-000000000102';
UPDATE beds SET current_resident_id = 'c0000002-0000-0000-0000-000000000003' WHERE id = 'b0000002-0000-0000-0000-000000000103';
UPDATE beds SET current_resident_id = 'c0000002-0000-0000-0000-000000000004' WHERE id = 'b0000002-0000-0000-0000-000000000104';

INSERT INTO staff (id, user_id, facility_id, organization_id, first_name, last_name, phone, email, staff_role, employment_status, hire_date, hourly_rate, is_full_time) VALUES
  ('50000002-0000-0000-0000-000000000001',NULL,'00000000-0000-0000-0002-000000000002','00000000-0000-0000-0000-000000000001','Kim','Alden','386-339-1701','kim.alden.rising@circleoflife.demo','administrator','active','2016-04-01',3400,true),
  ('50000002-0000-0000-0000-000000000002',NULL,'00000000-0000-0000-0002-000000000002','00000000-0000-0000-0000-000000000001','Leo','Briggs','386-339-1702','leo.briggs.rising@circleoflife.demo','lpn','active','2019-08-01',2700,true),
  ('50000002-0000-0000-0000-000000000003',NULL,'00000000-0000-0000-0002-000000000002','00000000-0000-0000-0000-000000000001','Mia','Cortez','386-339-1703','mia.cortez.rising@circleoflife.demo','cna','active','2021-03-15',1650,true),
  ('50000002-0000-0000-0000-000000000004',NULL,'00000000-0000-0000-0002-000000000002','00000000-0000-0000-0000-000000000001','Noah','Diaz','386-339-1704','noah.diaz.rising@circleoflife.demo','cna','active','2022-11-01',1650,true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO staff_certifications (id, staff_id, facility_id, organization_id, certification_type, certification_name, issuing_authority, certificate_number, issue_date, expiration_date, status) VALUES
  ('51000002-0000-0000-0000-000000000001','50000002-0000-0000-0000-000000000002','00000000-0000-0000-0002-000000000002','00000000-0000-0000-0000-000000000001','lpn_license','Licensed Practical Nurse','Florida Board of Nursing','LPN-RO-2019','2019-08-01','2027-08-01','active'),
  ('51000002-0000-0000-0000-000000000002','50000002-0000-0000-0000-000000000003','00000000-0000-0000-0002-000000000002','00000000-0000-0000-0000-000000000001','cna_certification','Certified Nursing Assistant','Florida DOEA','CNA-RO-2021','2021-03-15','2025-03-15','active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO care_plans (id, resident_id, facility_id, organization_id, version, status, effective_date, review_due_date, notes) VALUES
  ('60000002-0000-0000-0000-000000000001','c0000002-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000002','00000000-0000-0000-0000-000000000001',1,'active','2024-02-15','2026-06-15','Rising Oaks — hypertension and mobility plan.'),
  ('60000002-0000-0000-0000-000000000002','c0000002-0000-0000-0000-000000000003','00000000-0000-0000-0002-000000000002','00000000-0000-0000-0000-000000000001',1,'active','2024-06-01','2026-05-01','Rising Oaks — dementia care plan.')
ON CONFLICT (id) DO NOTHING;

INSERT INTO care_plan_items (id, care_plan_id, resident_id, facility_id, organization_id, category, title, description, assistance_level, frequency, goal, interventions, sort_order) VALUES
  ('61000002-0000-0000-0000-000000000001','60000002-0000-0000-0000-000000000001','c0000002-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000002','00000000-0000-0000-0000-000000000001','mobility','Ambulation safety','Cane-assisted ambulation; watch for fatigue.','limited_assist','Daily','No falls in quarter',ARRAY['Gait belt as needed','Clear hallways'],1),
  ('61000002-0000-0000-0000-000000000002','60000002-0000-0000-0000-000000000002','c0000002-0000-0000-0000-000000000003','00000000-0000-0000-0002-000000000002','00000000-0000-0000-0000-000000000001','cognitive','Wandering precautions','Door alarms; redirect to safe activities.','extensive_assist','Every shift','No unsupervised exits',ARRAY['Wander bracelet','Frequent checks'],1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO resident_medications (id, resident_id, facility_id, organization_id, medication_name, generic_name, strength, form, route, frequency, scheduled_times, instructions, indication, prescriber_name, status, start_date, order_date) VALUES
  ('70000002-0000-0000-0000-000000000001','c0000002-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000002','00000000-0000-0000-0000-000000000001','Lisinopril','Lisinopril','10mg','Tablet','oral','daily',ARRAY['08:00']::time[],'Take in AM','HTN','Dr. Hayes','active','2024-02-01','2024-02-01'),
  ('70000002-0000-0000-0000-000000000002','c0000002-0000-0000-0000-000000000002','00000000-0000-0000-0002-000000000002','00000000-0000-0000-0000-000000000001','Metformin','Metformin HCl','500mg','Tablet','oral','bid',ARRAY['08:00','18:00']::time[],'With meals','DM2','Dr. Rivera','active','2023-09-15','2023-09-15'),
  ('70000002-0000-0000-0000-000000000003','c0000002-0000-0000-0000-000000000003','00000000-0000-0000-0002-000000000002','00000000-0000-0000-0000-000000000001','Donepezil','Donepezil','10mg','Tablet','oral','daily',ARRAY['20:00']::time[],'At bedtime','AD','Dr. Hayes','active','2024-05-20','2024-05-20'),
  ('70000002-0000-0000-0000-000000000004','c0000002-0000-0000-0000-000000000004','00000000-0000-0000-0002-000000000002','00000000-0000-0000-0000-000000000001','Ibuprofen','Ibuprofen','200mg','Tablet','oral','prn',ARRAY[]::time[],'PRN pain','OA','Dr. Crawford','active','2025-02-01','2025-02-01')
ON CONFLICT (id) DO NOTHING;

INSERT INTO daily_logs (id, resident_id, facility_id, organization_id, log_date, shift, logged_by, general_notes, mood, temperature, blood_pressure_systolic, blood_pressure_diastolic, pulse, oxygen_saturation) VALUES
  ('80000002-0000-0000-0000-000000000001','c0000002-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000002','00000000-0000-0000-0000-000000000001',CURRENT_DATE,'day','a0000000-0000-0000-0000-000000000004','Stable vitals; walked in hallway with cane.','Content',98.0,132,80,72,97.0),
  ('80000002-0000-0000-0000-000000000002','c0000002-0000-0000-0000-000000000003','00000000-0000-0000-0002-000000000002','00000000-0000-0000-0000-000000000001',CURRENT_DATE,'day','a0000000-0000-0000-0000-000000000005','Participated in morning trivia; ate 80% breakfast.','Pleasant',98.2,128,76,74,98.0)
ON CONFLICT (id) DO NOTHING;

INSERT INTO activities (id, facility_id, organization_id, name, description, default_day_of_week, default_start_time, default_duration_minutes, facilitator, is_recurring) VALUES
  ('ac000002-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000002','00000000-0000-0000-0000-000000000001','Walking Club','Outdoor courtyard walk weather permitting',ARRAY[1,3,5],'10:00',30,'Mia Cortez',true),
  ('ac000002-0000-0000-0000-000000000002','00000000-0000-0000-0002-000000000002','00000000-0000-0000-0000-000000000001','Trivia','Group trivia in common room',ARRAY[2,4],'14:00',45,'Kim Alden',true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO activity_sessions (id, activity_id, facility_id, organization_id, session_date, start_time, end_time, facilitator_name, cancelled) VALUES
  ('a5000002-0000-0000-0000-000000000001','ac000002-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000002','00000000-0000-0000-0000-000000000001',CURRENT_DATE,(CURRENT_DATE + '10:00'::time)::timestamptz,(CURRENT_DATE + '10:30'::time)::timestamptz,'Mia Cortez',false),
  ('a5000002-0000-0000-0000-000000000002','ac000002-0000-0000-0000-000000000002','00000000-0000-0000-0002-000000000002','00000000-0000-0000-0000-000000000001',CURRENT_DATE + 1,(CURRENT_DATE + 1 + '14:00'::time)::timestamptz,(CURRENT_DATE + 1 + '14:45'::time)::timestamptz,'Kim Alden',false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO incidents (id, resident_id, facility_id, organization_id, incident_number, category, severity, status, occurred_at, discovered_at, shift, location_description, description, immediate_actions, contributing_factors, fall_witnessed, injury_occurred, reported_by, nurse_notified, nurse_notified_at, administrator_notified, family_notified, family_notified_at) VALUES
  ('90000002-0000-0000-0000-000000000001','c0000002-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000002','00000000-0000-0000-0000-000000000001',
   'ROS-2026-0001','other','level_1','resolved',
   now() - interval '3 days', now() - interval '3 days','day',
   'Hallway outside A101',
   'Resident briefly lost balance while turning with cane; staff assisted immediately. No injury.',
   ARRAY['Staff within arm''s reach','Gait belt offered for future ambulation'],
   ARRAY['Uneven flooring mat edge'],false,false,'a0000000-0000-0000-0000-000000000004',
   true, now() - interval '3 days',true,false,NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO rate_schedules (id, facility_id, organization_id, name, effective_date, base_rate_private, base_rate_semi_private, care_surcharge_level_1, care_surcharge_level_2, care_surcharge_level_3, community_fee, respite_daily_rate) VALUES
  ('b3000002-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000002','00000000-0000-0000-0000-000000000001','2025 Standard — Rising Oaks','2025-01-01',425000,375000,0,35000,75000,250000,17500)
ON CONFLICT (id) DO NOTHING;

INSERT INTO resident_payers (id, resident_id, facility_id, organization_id, payer_type, is_primary, payer_name, effective_date) VALUES
  ('b4000002-0000-0000-0000-000000000001','c0000002-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000002','00000000-0000-0000-0000-000000000001','private_pay',true,'Paul Rivers','2024-02-01'),
  ('b4000002-0000-0000-0000-000000000002','c0000002-0000-0000-0000-000000000003','00000000-0000-0000-0002-000000000002','00000000-0000-0000-0000-000000000001','medicaid_oss',true,'Florida Medicaid','2024-05-20')
ON CONFLICT (id) DO NOTHING;

INSERT INTO invoices (id, resident_id, facility_id, organization_id, entity_id, invoice_number, invoice_date, due_date, period_start, period_end, status, subtotal, total, amount_paid, balance_due) VALUES
  ('b5000002-0000-0000-0000-000000000001','c0000002-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000002','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0001-000000000002','ROS-2026-03-001','2026-03-01','2026-03-15','2026-03-01','2026-03-31','sent',460000,460000,0,460000),
  ('b5000002-0000-0000-0000-000000000002','c0000002-0000-0000-0000-000000000003','00000000-0000-0000-0002-000000000002','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0001-000000000002','ROS-2026-03-002','2026-03-01','2026-03-15','2026-03-01','2026-03-31','partial',500000,500000,250000,250000)
ON CONFLICT (id) DO NOTHING;

INSERT INTO invoice_line_items (id, invoice_id, organization_id, line_type, description, quantity, unit_price, total, sort_order) VALUES
  ('b6000002-0000-0000-0000-000000000001','b5000002-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','room_and_board','Private Room — Monthly Rate',1,425000,425000,1),
  ('b6000002-0000-0000-0000-000000000002','b5000002-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','care_surcharge','Level 2 Care Surcharge',1,35000,35000,2),
  ('b6000002-0000-0000-0000-000000000003','b5000002-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','room_and_board','Private Room — Monthly Rate',1,425000,425000,1),
  ('b6000002-0000-0000-0000-000000000004','b5000002-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','care_surcharge','Level 3 Care Surcharge',1,75000,75000,2)
ON CONFLICT (id) DO NOTHING;

INSERT INTO payments (id, resident_id, facility_id, organization_id, entity_id, invoice_id, payment_date, amount, payment_method, reference_number, payer_name) VALUES
  ('b7000002-0000-0000-0000-000000000001','c0000002-0000-0000-0000-000000000003','00000000-0000-0000-0002-000000000002','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0001-000000000002','b5000002-0000-0000-0000-000000000002','2026-03-10',250000,'ach','ACH-ROS-1','Mai Nguyen')
ON CONFLICT (id) DO NOTHING;

INSERT INTO schedules (id, facility_id, organization_id, week_start_date, status, published_at) VALUES
  ('b8000002-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000002','00000000-0000-0000-0000-000000000001', date_trunc('week', CURRENT_DATE)::date, 'published', now() - interval '2 days')
ON CONFLICT (id) DO NOTHING;

INSERT INTO shift_assignments (id, schedule_id, staff_id, facility_id, organization_id, shift_date, shift_type, unit_id, status) VALUES
  ('b9000002-0000-0000-0000-000000000001','b8000002-0000-0000-0000-000000000001','50000002-0000-0000-0000-000000000003','00000000-0000-0000-0002-000000000002','00000000-0000-0000-0000-000000000001',CURRENT_DATE,'day','10000002-0000-0000-0000-000000000001','confirmed'),
  ('b9000002-0000-0000-0000-000000000002','b8000002-0000-0000-0000-000000000001','50000002-0000-0000-0000-000000000004','00000000-0000-0000-0002-000000000002','00000000-0000-0000-0000-000000000001',CURRENT_DATE,'day','10000002-0000-0000-0000-000000000001','confirmed')
ON CONFLICT (id) DO NOTHING;

INSERT INTO time_records (id, staff_id, shift_assignment_id, facility_id, organization_id, clock_in, clock_out, clock_in_method, clock_out_method, scheduled_hours, actual_hours, regular_hours, approved) VALUES
  ('ba000002-0000-0000-0000-000000000001','50000002-0000-0000-0000-000000000003','b9000002-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000002','00000000-0000-0000-0000-000000000001',(CURRENT_DATE + '06:58'::time)::timestamptz,(CURRENT_DATE + '15:04'::time)::timestamptz,'mobile_app','mobile_app',8.0,8.1,8.1,false),
  ('ba000002-0000-0000-0000-000000000002','50000002-0000-0000-0000-000000000004','b9000002-0000-0000-0000-000000000002','00000000-0000-0000-0002-000000000002','00000000-0000-0000-0000-000000000001',(CURRENT_DATE + '07:02'::time)::timestamptz,(CURRENT_DATE + '15:01'::time)::timestamptz,'mobile_app','mobile_app',8.0,7.98,7.98,false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO staffing_ratio_snapshots (id, facility_id, organization_id, shift, residents_present, staff_on_duty, ratio, required_ratio, is_compliant, staff_detail) VALUES
  ('bb000002-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000002','00000000-0000-0000-0000-000000000001','day',4,2,2.0,5.00,true,'[{"name":"Mia Cortez","role":"cna"},{"name":"Noah Diaz","role":"cna"}]')
ON CONFLICT (id) DO NOTHING;

INSERT INTO census_daily_log (id, facility_id, organization_id, log_date, total_licensed_beds, occupied_beds, available_beds, hold_beds, maintenance_beds, occupancy_rate) VALUES
  ('cd000002-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000002','00000000-0000-0000-0000-000000000001',CURRENT_DATE,52,4,47,1,0,0.0769)
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- FACILITY 003 — Homewood Lodge ALF
-- =============================================================================
INSERT INTO units (id, facility_id, organization_id, name, floor_number, sort_order) VALUES
  ('10000003-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000003','00000000-0000-0000-0000-000000000001','North Wing',1,1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO rooms (id, facility_id, organization_id, unit_id, room_number, room_type, max_occupancy, is_ada_accessible, near_nursing_station) VALUES
  ('d0000003-0000-0000-0000-000000000101','00000000-0000-0000-0002-000000000003','00000000-0000-0000-0000-000000000001','10000003-0000-0000-0000-000000000001','N101','private',1,true,true),
  ('d0000003-0000-0000-0000-000000000102','00000000-0000-0000-0002-000000000003','00000000-0000-0000-0000-000000000001','10000003-0000-0000-0000-000000000001','N102','private',1,false,false),
  ('d0000003-0000-0000-0000-000000000103','00000000-0000-0000-0002-000000000003','00000000-0000-0000-0000-000000000001','10000003-0000-0000-0000-000000000001','N103','semi_private',2,false,false),
  ('d0000003-0000-0000-0000-000000000104','00000000-0000-0000-0002-000000000003','00000000-0000-0000-0000-000000000001','10000003-0000-0000-0000-000000000001','N104','private',1,true,false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO beds (id, room_id, facility_id, organization_id, bed_label, bed_type, status) VALUES
  ('b0000003-0000-0000-0000-000000000101','d0000003-0000-0000-0000-000000000101','00000000-0000-0000-0002-000000000003','00000000-0000-0000-0000-000000000001','N101-A','alf_intermediate','occupied'),
  ('b0000003-0000-0000-0000-000000000102','d0000003-0000-0000-0000-000000000102','00000000-0000-0000-0002-000000000003','00000000-0000-0000-0000-000000000001','N102-A','alf_intermediate','occupied'),
  ('b0000003-0000-0000-0000-000000000103','d0000003-0000-0000-0000-000000000103','00000000-0000-0000-0002-000000000003','00000000-0000-0000-0000-000000000001','N103-A','alf_intermediate','occupied'),
  ('b0000003-0000-0000-0000-000000000104','d0000003-0000-0000-0000-000000000104','00000000-0000-0000-0002-000000000003','00000000-0000-0000-0000-000000000001','N104-A','alf_intermediate','occupied')
ON CONFLICT (id) DO NOTHING;

INSERT INTO residents (id, facility_id, organization_id, bed_id, first_name, last_name, preferred_name, date_of_birth, gender, ssn_last_four, status, acuity_level, admission_date, primary_physician_name, primary_physician_phone, primary_diagnosis, diagnosis_list, allergy_list, diet_order, code_status, ambulatory, assistive_device, fall_risk_level, elopement_risk, wandering_risk, primary_payer, monthly_base_rate, monthly_care_surcharge, monthly_total_rate, rate_effective_date, responsible_party_name, responsible_party_relationship, responsible_party_phone, emergency_contact_1_name, emergency_contact_1_relationship, emergency_contact_1_phone, preferred_wake_time, preferred_bed_time) VALUES
  ('c0000003-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000003','00000000-0000-0000-0000-000000000001','b0000003-0000-0000-0000-000000000101','Elena','Price',NULL,'1942-04-18','female','6611','active','level_2','2024-01-10','Dr. Hayes','386-755-1122','CHF',ARRAY['CHF','HTN'],ARRAY[]::text[],'Low sodium','full_code',true,'Walker','moderate',false,false,'private_pay',425000,35000,460000,'2024-01-10','Elena Price Jr','Niece','386-555-0301','Elena Price Jr','Niece','386-555-0301','07:00','20:30'),
  ('c0000003-0000-0000-0000-000000000002','00000000-0000-0000-0002-000000000003','00000000-0000-0000-0000-000000000001','b0000003-0000-0000-0000-000000000102','Felix','Stone',NULL,'1948-09-01','male','7722','active','level_1','2023-12-05','Dr. Rivera','386-755-2233','BPH',ARRAY['BPH'],ARRAY[]::text[],'Regular','full_code',true,NULL,'standard',false,false,'private_pay',425000,0,425000,'2023-12-05','Felix Stone','Son','386-555-0302','Felix Stone','Son','386-555-0302','06:30','21:30'),
  ('c0000003-0000-0000-0000-000000000003','00000000-0000-0000-0002-000000000003','00000000-0000-0000-0000-000000000001','b0000003-0000-0000-0000-000000000103','Gina','Morales','Gina','1938-06-25','female','8833','active','level_3','2024-07-12','Dr. Hayes','386-755-1122','Vascular dementia',ARRAY['Vascular dementia'],ARRAY['Latex'],'Pureed','full_code',true,'Wheelchair','high',false,true,'medicaid_oss',425000,75000,500000,'2024-07-12','Carlos Morales','Son','386-555-0303','Carlos Morales','Son','386-555-0303','08:00','19:00'),
  ('c0000003-0000-0000-0000-000000000004','00000000-0000-0000-0002-000000000003','00000000-0000-0000-0000-000000000001','b0000003-0000-0000-0000-000000000104','Henry','Voss',NULL,'1951-02-14','male','9944','active','level_1','2025-01-20','Dr. Crawford','386-755-3344','Hyperlipidemia',ARRAY['Hyperlipidemia'],ARRAY[]::text[],'Heart healthy','full_code',true,NULL,'standard',false,false,'ltc_insurance',425000,0,425000,'2025-01-20','Henry Voss','Wife','386-555-0304','Henry Voss','Wife','386-555-0304','06:00','22:00')
ON CONFLICT (id) DO NOTHING;

UPDATE beds SET current_resident_id = 'c0000003-0000-0000-0000-000000000001' WHERE id = 'b0000003-0000-0000-0000-000000000101';
UPDATE beds SET current_resident_id = 'c0000003-0000-0000-0000-000000000002' WHERE id = 'b0000003-0000-0000-0000-000000000102';
UPDATE beds SET current_resident_id = 'c0000003-0000-0000-0000-000000000003' WHERE id = 'b0000003-0000-0000-0000-000000000103';
UPDATE beds SET current_resident_id = 'c0000003-0000-0000-0000-000000000004' WHERE id = 'b0000003-0000-0000-0000-000000000104';

INSERT INTO staff (id, user_id, facility_id, organization_id, first_name, last_name, phone, email, staff_role, employment_status, hire_date, hourly_rate, is_full_time) VALUES
  ('50000003-0000-0000-0000-000000000001',NULL,'00000000-0000-0000-0002-000000000003','00000000-0000-0000-0000-000000000001','Iris','Yates','386-339-1801','iris.yates.homewood@circleoflife.demo','administrator','active','2015-02-01',3450,true),
  ('50000003-0000-0000-0000-000000000002',NULL,'00000000-0000-0000-0002-000000000003','00000000-0000-0000-0000-000000000001','Jake','Zimmer','386-339-1802','jake.zimmer.homewood@circleoflife.demo','lpn','active','2018-05-01',2750,true),
  ('50000003-0000-0000-0000-000000000003',NULL,'00000000-0000-0000-0002-000000000003','00000000-0000-0000-0000-000000000001','Kelly','Abbott','386-339-1803','kelly.abbott.homewood@circleoflife.demo','cna','active','2020-09-10',1650,true),
  ('50000003-0000-0000-0000-000000000004',NULL,'00000000-0000-0000-0002-000000000003','00000000-0000-0000-0000-000000000001','Liam','Bishop','386-339-1804','liam.bishop.homewood@circleoflife.demo','cna','active','2023-01-15',1650,true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO staff_certifications (id, staff_id, facility_id, organization_id, certification_type, certification_name, issuing_authority, certificate_number, issue_date, expiration_date, status) VALUES
  ('51000003-0000-0000-0000-000000000001','50000003-0000-0000-0000-000000000002','00000000-0000-0000-0002-000000000003','00000000-0000-0000-0000-000000000001','lpn_license','Licensed Practical Nurse','Florida Board of Nursing','LPN-HW-2018','2018-05-01','2027-05-01','active'),
  ('51000003-0000-0000-0000-000000000002','50000003-0000-0000-0000-000000000003','00000000-0000-0000-0002-000000000003','00000000-0000-0000-0000-000000000001','cpr_bls','CPR/BLS Provider','American Heart Association','BLS-HW-2024','2024-06-01','2026-06-01','active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO care_plans (id, resident_id, facility_id, organization_id, version, status, effective_date, review_due_date, notes) VALUES
  ('60000003-0000-0000-0000-000000000001','c0000003-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000003','00000000-0000-0000-0000-000000000001',1,'active','2024-01-20','2026-07-01','Homewood — CHF care plan.'),
  ('60000003-0000-0000-0000-000000000002','c0000003-0000-0000-0000-000000000003','00000000-0000-0000-0002-000000000003','00000000-0000-0000-0000-000000000001',1,'active','2024-08-01','2026-04-01','Homewood — dementia nutrition plan.')
ON CONFLICT (id) DO NOTHING;

INSERT INTO care_plan_items (id, care_plan_id, resident_id, facility_id, organization_id, category, title, description, assistance_level, frequency, goal, interventions, sort_order) VALUES
  ('61000003-0000-0000-0000-000000000001','60000003-0000-0000-0000-000000000001','c0000003-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000003','00000000-0000-0000-0000-000000000001','dietary','Sodium restriction','Daily weights; fluid watch.','limited_assist','Daily','Stable weight',ARRAY['Daily weight','Fluid log'],1),
  ('61000003-0000-0000-0000-000000000002','60000003-0000-0000-0000-000000000002','c0000003-0000-0000-0000-000000000003','00000000-0000-0000-0002-000000000003','00000000-0000-0000-0000-000000000001','dietary','Pureed diet safety','Aspiration precautions during meals.','extensive_assist','Every meal','No choking events',ARRAY['Small bites','Upright positioning'],1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO resident_medications (id, resident_id, facility_id, organization_id, medication_name, generic_name, strength, form, route, frequency, scheduled_times, instructions, indication, prescriber_name, status, start_date, order_date) VALUES
  ('70000003-0000-0000-0000-000000000001','c0000003-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000003','00000000-0000-0000-0000-000000000001','Carvedilol','Carvedilol','12.5mg','Tablet','oral','bid',ARRAY['08:00','20:00']::time[],'With food','CHF','Dr. Hayes','active','2024-01-10','2024-01-10'),
  ('70000003-0000-0000-0000-000000000002','c0000003-0000-0000-0000-000000000002','00000000-0000-0000-0002-000000000003','00000000-0000-0000-0000-000000000001','Tamsulosin','Tamsulosin','0.4mg','Capsule','oral','daily',ARRAY['21:00']::time[],'After dinner','BPH','Dr. Rivera','active','2023-12-05','2023-12-05'),
  ('70000003-0000-0000-0000-000000000003','c0000003-0000-0000-0000-000000000003','00000000-0000-0000-0002-000000000003','00000000-0000-0000-0000-000000000001','Memantine','Memantine','10mg','Tablet','oral','bid',ARRAY['08:00','20:00']::time[],'With meals','Dementia','Dr. Hayes','active','2024-07-12','2024-07-12'),
  ('70000003-0000-0000-0000-000000000004','c0000003-0000-0000-0000-000000000004','00000000-0000-0000-0002-000000000003','00000000-0000-0000-0000-000000000001','Atorvastatin','Atorvastatin','20mg','Tablet','oral','daily',ARRAY['20:00']::time[],'Evening','Hyperlipidemia','Dr. Crawford','active','2025-01-20','2025-01-20')
ON CONFLICT (id) DO NOTHING;

INSERT INTO daily_logs (id, resident_id, facility_id, organization_id, log_date, shift, logged_by, general_notes, mood, temperature, blood_pressure_systolic, blood_pressure_diastolic, pulse, oxygen_saturation) VALUES
  ('80000003-0000-0000-0000-000000000001','c0000003-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000003','00000000-0000-0000-0000-000000000001',CURRENT_DATE,'day','a0000000-0000-0000-0000-000000000004','Weight stable; low-sodium lunch tolerated.','Calm',98.1,126,78,70,96.5),
  ('80000003-0000-0000-0000-000000000002','c0000003-0000-0000-0000-000000000003','00000000-0000-0000-0002-000000000003','00000000-0000-0000-0000-000000000001',CURRENT_DATE,'day','a0000000-0000-0000-0000-000000000005','Pureed lunch 85%; no coughing.','Content',98.3,118,72,76,98.0)
ON CONFLICT (id) DO NOTHING;

INSERT INTO activities (id, facility_id, organization_id, name, description, default_day_of_week, default_start_time, default_duration_minutes, facilitator, is_recurring) VALUES
  ('ac000003-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000003','00000000-0000-0000-0000-000000000001','Garden Club','Raised-bed gardening',ARRAY[4],'09:30',40,'Iris Yates',true),
  ('ac000003-0000-0000-0000-000000000002','00000000-0000-0000-0002-000000000003','00000000-0000-0000-0000-000000000001','Devotions','Non-denominational reading circle',ARRAY[0],'10:30',30,'Kelly Abbott',true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO activity_sessions (id, activity_id, facility_id, organization_id, session_date, start_time, end_time, facilitator_name, cancelled) VALUES
  ('a5000003-0000-0000-0000-000000000001','ac000003-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000003','00000000-0000-0000-0000-000000000001',CURRENT_DATE,(CURRENT_DATE + '09:30'::time)::timestamptz,(CURRENT_DATE + '10:10'::time)::timestamptz,'Iris Yates',false),
  ('a5000003-0000-0000-0000-000000000002','ac000003-0000-0000-0000-000000000002','00000000-0000-0000-0002-000000000003','00000000-0000-0000-0000-000000000001',CURRENT_DATE + 2,(CURRENT_DATE + 2 + '10:30'::time)::timestamptz,(CURRENT_DATE + 2 + '11:00'::time)::timestamptz,'Kelly Abbott',false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO incidents (id, resident_id, facility_id, organization_id, incident_number, category, severity, status, occurred_at, discovered_at, shift, location_description, description, immediate_actions, contributing_factors, fall_witnessed, injury_occurred, reported_by, nurse_notified, nurse_notified_at, administrator_notified, family_notified, family_notified_at) VALUES
  ('90000003-0000-0000-0000-000000000001','c0000003-0000-0000-0000-000000000002','00000000-0000-0000-0002-000000000003','00000000-0000-0000-0000-000000000001',
   'HOM-2026-0001','medication_error','level_2','resolved',
   now() - interval '4 days', now() - interval '4 days','day',
   'Med cart — N102',
   'Morning med pass: resident questioned tablet appearance; nurse verified correct med before administration. No dose given in error.',
   ARRAY['Hold until verified','Double-check with pharmacy photo'],
   ARRAY['Look-alike packaging'],false,false,'a0000000-0000-0000-0000-000000000003',
   true, now() - interval '4 days',true,true, now() - interval '4 days')
ON CONFLICT (id) DO NOTHING;

INSERT INTO rate_schedules (id, facility_id, organization_id, name, effective_date, base_rate_private, base_rate_semi_private, care_surcharge_level_1, care_surcharge_level_2, care_surcharge_level_3, community_fee, respite_daily_rate) VALUES
  ('b3000003-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000003','00000000-0000-0000-0000-000000000001','2025 Standard — Homewood','2025-01-01',425000,375000,0,35000,75000,250000,17500)
ON CONFLICT (id) DO NOTHING;

INSERT INTO resident_payers (id, resident_id, facility_id, organization_id, payer_type, is_primary, payer_name, effective_date) VALUES
  ('b4000003-0000-0000-0000-000000000001','c0000003-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000003','00000000-0000-0000-0000-000000000001','private_pay',true,'Elena Price Jr','2024-01-10'),
  ('b4000003-0000-0000-0000-000000000002','c0000003-0000-0000-0000-000000000003','00000000-0000-0000-0002-000000000003','00000000-0000-0000-0000-000000000001','medicaid_oss',true,'Florida Medicaid','2024-07-12')
ON CONFLICT (id) DO NOTHING;

INSERT INTO invoices (id, resident_id, facility_id, organization_id, entity_id, invoice_number, invoice_date, due_date, period_start, period_end, status, subtotal, total, amount_paid, balance_due) VALUES
  ('b5000003-0000-0000-0000-000000000001','c0000003-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000003','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0001-000000000003','HOM-2026-03-001','2026-03-01','2026-03-15','2026-03-01','2026-03-31','paid',460000,460000,460000,0),
  ('b5000003-0000-0000-0000-000000000002','c0000003-0000-0000-0000-000000000003','00000000-0000-0000-0002-000000000003','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0001-000000000003','HOM-2026-03-002','2026-03-01','2026-03-15','2026-03-01','2026-03-31','sent',500000,500000,0,500000)
ON CONFLICT (id) DO NOTHING;

INSERT INTO invoice_line_items (id, invoice_id, organization_id, line_type, description, quantity, unit_price, total, sort_order) VALUES
  ('b6000003-0000-0000-0000-000000000001','b5000003-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','room_and_board','Private Room — Monthly Rate',1,425000,425000,1),
  ('b6000003-0000-0000-0000-000000000002','b5000003-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','care_surcharge','Level 2 Care Surcharge',1,35000,35000,2),
  ('b6000003-0000-0000-0000-000000000003','b5000003-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','room_and_board','Private Room — Monthly Rate',1,425000,425000,1),
  ('b6000003-0000-0000-0000-000000000004','b5000003-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','care_surcharge','Level 3 Care Surcharge',1,75000,75000,2)
ON CONFLICT (id) DO NOTHING;

INSERT INTO payments (id, resident_id, facility_id, organization_id, entity_id, invoice_id, payment_date, amount, payment_method, reference_number, payer_name) VALUES
  ('b7000003-0000-0000-0000-000000000001','c0000003-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000003','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0001-000000000003','b5000003-0000-0000-0000-000000000001','2026-03-08',460000,'check','CHK-HW-1','Elena Price Jr')
ON CONFLICT (id) DO NOTHING;

INSERT INTO schedules (id, facility_id, organization_id, week_start_date, status, published_at) VALUES
  ('b8000003-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000003','00000000-0000-0000-0000-000000000001', date_trunc('week', CURRENT_DATE)::date, 'published', now() - interval '1 day')
ON CONFLICT (id) DO NOTHING;

INSERT INTO shift_assignments (id, schedule_id, staff_id, facility_id, organization_id, shift_date, shift_type, unit_id, status) VALUES
  ('b9000003-0000-0000-0000-000000000001','b8000003-0000-0000-0000-000000000001','50000003-0000-0000-0000-000000000003','00000000-0000-0000-0002-000000000003','00000000-0000-0000-0000-000000000001',CURRENT_DATE,'day','10000003-0000-0000-0000-000000000001','confirmed'),
  ('b9000003-0000-0000-0000-000000000002','b8000003-0000-0000-0000-000000000001','50000003-0000-0000-0000-000000000004','00000000-0000-0000-0002-000000000003','00000000-0000-0000-0000-000000000001',CURRENT_DATE,'day','10000003-0000-0000-0000-000000000001','confirmed')
ON CONFLICT (id) DO NOTHING;

INSERT INTO time_records (id, staff_id, shift_assignment_id, facility_id, organization_id, clock_in, clock_out, clock_in_method, clock_out_method, scheduled_hours, actual_hours, regular_hours, approved) VALUES
  ('ba000003-0000-0000-0000-000000000001','50000003-0000-0000-0000-000000000003','b9000003-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000003','00000000-0000-0000-0000-000000000001',(CURRENT_DATE + '07:00'::time)::timestamptz,(CURRENT_DATE + '15:02'::time)::timestamptz,'mobile_app','mobile_app',8.0,8.03,8.03,false),
  ('ba000003-0000-0000-0000-000000000002','50000003-0000-0000-0000-000000000004','b9000003-0000-0000-0000-000000000002','00000000-0000-0000-0002-000000000003','00000000-0000-0000-0000-000000000001',(CURRENT_DATE + '06:55'::time)::timestamptz,(CURRENT_DATE + '15:00'::time)::timestamptz,'kiosk','kiosk',8.0,8.08,8.08,true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO staffing_ratio_snapshots (id, facility_id, organization_id, shift, residents_present, staff_on_duty, ratio, required_ratio, is_compliant, staff_detail) VALUES
  ('bb000003-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000003','00000000-0000-0000-0000-000000000001','day',4,2,2.0,5.00,true,'[{"name":"Kelly Abbott","role":"cna"},{"name":"Liam Bishop","role":"cna"}]')
ON CONFLICT (id) DO NOTHING;

INSERT INTO census_daily_log (id, facility_id, organization_id, log_date, total_licensed_beds, occupied_beds, available_beds, hold_beds, maintenance_beds, occupancy_rate) VALUES
  ('cd000003-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000003','00000000-0000-0000-0000-000000000001',CURRENT_DATE,36,4,31,1,0,0.1111)
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- FACILITY 004 — Plantation ALF
-- =============================================================================
INSERT INTO units (id, facility_id, organization_id, name, floor_number, sort_order) VALUES
  ('10000004-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000004','00000000-0000-0000-0000-000000000001','Summers Wing',1,1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO rooms (id, facility_id, organization_id, unit_id, room_number, room_type, max_occupancy, is_ada_accessible, near_nursing_station) VALUES
  ('d0000004-0000-0000-0000-000000000101','00000000-0000-0000-0002-000000000004','00000000-0000-0000-0000-000000000001','10000004-0000-0000-0000-000000000001','S101','private',1,true,true),
  ('d0000004-0000-0000-0000-000000000102','00000000-0000-0000-0002-000000000004','00000000-0000-0000-0000-000000000001','10000004-0000-0000-0000-000000000001','S102','private',1,false,false),
  ('d0000004-0000-0000-0000-000000000103','00000000-0000-0000-0002-000000000004','00000000-0000-0000-0000-000000000001','10000004-0000-0000-0000-000000000001','S103','semi_private',2,false,false),
  ('d0000004-0000-0000-0000-000000000104','00000000-0000-0000-0002-000000000004','00000000-0000-0000-0000-000000000001','10000004-0000-0000-0000-000000000001','S104','private',1,true,false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO beds (id, room_id, facility_id, organization_id, bed_label, bed_type, status) VALUES
  ('b0000004-0000-0000-0000-000000000101','d0000004-0000-0000-0000-000000000101','00000000-0000-0000-0002-000000000004','00000000-0000-0000-0000-000000000001','S101-A','alf_intermediate','occupied'),
  ('b0000004-0000-0000-0000-000000000102','d0000004-0000-0000-0000-000000000102','00000000-0000-0000-0002-000000000004','00000000-0000-0000-0000-000000000001','S102-A','alf_intermediate','occupied'),
  ('b0000004-0000-0000-0000-000000000103','d0000004-0000-0000-0000-000000000103','00000000-0000-0000-0002-000000000004','00000000-0000-0000-0000-000000000001','S103-A','alf_intermediate','occupied'),
  ('b0000004-0000-0000-0000-000000000104','d0000004-0000-0000-0000-000000000104','00000000-0000-0000-0002-000000000004','00000000-0000-0000-0000-000000000001','S104-A','alf_intermediate','occupied')
ON CONFLICT (id) DO NOTHING;

INSERT INTO residents (id, facility_id, organization_id, bed_id, first_name, last_name, preferred_name, date_of_birth, gender, ssn_last_four, status, acuity_level, admission_date, primary_physician_name, primary_physician_phone, primary_diagnosis, diagnosis_list, allergy_list, diet_order, code_status, ambulatory, assistive_device, fall_risk_level, elopement_risk, wandering_risk, primary_payer, monthly_base_rate, monthly_care_surcharge, monthly_total_rate, rate_effective_date, responsible_party_name, responsible_party_relationship, responsible_party_phone, emergency_contact_1_name, emergency_contact_1_relationship, emergency_contact_1_phone, preferred_wake_time, preferred_bed_time) VALUES
  ('c0000004-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000004','00000000-0000-0000-0000-000000000001','b0000004-0000-0000-0000-000000000101','Paula','Ingram',NULL,'1940-12-03','female','1100','active','level_2','2024-04-01','Dr. Hayes','386-755-1122','Osteoarthritis',ARRAY['OA','HTN'],ARRAY[]::text[],'Regular','full_code',true,'Cane','moderate',false,false,'private_pay',425000,35000,460000,'2024-04-01','Paul Ingram','Son','386-555-0401','Paul Ingram','Son','386-555-0401','07:00','21:00'),
  ('c0000004-0000-0000-0000-000000000002','00000000-0000-0000-0002-000000000004','00000000-0000-0000-0000-000000000001','b0000004-0000-0000-0000-000000000102','Quinn','Ford',NULL,'1945-08-19','male','2211','active','level_1','2023-10-12','Dr. Rivera','386-755-2233','GERD',ARRAY['GERD'],ARRAY[]::text[],'Regular','full_code',true,NULL,'standard',false,false,'va_aid_attendance',425000,0,425000,'2023-10-12','Quinn Ford','Daughter','386-555-0402','Quinn Ford','Daughter','386-555-0402','06:45','22:00'),
  ('c0000004-0000-0000-0000-000000000003','00000000-0000-0000-0002-000000000004','00000000-0000-0000-0000-000000000001','b0000004-0000-0000-0000-000000000103','Rita','Gomez','Rita','1936-01-28','female','3322','active','level_3','2024-08-15','Dr. Hayes','386-755-1122','Parkinson''s disease',ARRAY['Parkinson''s disease'],ARRAY['Morphine'],'Mechanical soft','full_code',false,'Wheelchair','high',true,false,'private_pay',425000,75000,500000,'2024-08-15','Sofia Gomez','Daughter','386-555-0403','Sofia Gomez','Daughter','386-555-0403','07:30','19:30'),
  ('c0000004-0000-0000-0000-000000000004','00000000-0000-0000-0002-000000000004','00000000-0000-0000-0000-000000000001','b0000004-0000-0000-0000-000000000104','Steve','Hale',NULL,'1949-05-07','male','4433','active','level_1','2025-03-01','Dr. Crawford','386-755-3344','Hearing loss',ARRAY['Hearing loss'],ARRAY[]::text[],'Regular','full_code',true,NULL,'standard',false,false,'private_pay',425000,0,425000,'2025-03-01','Steve Hale','Wife','386-555-0404','Steve Hale','Wife','386-555-0404','06:30','21:30')
ON CONFLICT (id) DO NOTHING;

UPDATE beds SET current_resident_id = 'c0000004-0000-0000-0000-000000000001' WHERE id = 'b0000004-0000-0000-0000-000000000101';
UPDATE beds SET current_resident_id = 'c0000004-0000-0000-0000-000000000002' WHERE id = 'b0000004-0000-0000-0000-000000000102';
UPDATE beds SET current_resident_id = 'c0000004-0000-0000-0000-000000000003' WHERE id = 'b0000004-0000-0000-0000-000000000103';
UPDATE beds SET current_resident_id = 'c0000004-0000-0000-0000-000000000004' WHERE id = 'b0000004-0000-0000-0000-000000000104';

INSERT INTO staff (id, user_id, facility_id, organization_id, first_name, last_name, phone, email, staff_role, employment_status, hire_date, hourly_rate, is_full_time) VALUES
  ('50000004-0000-0000-0000-000000000001',NULL,'00000000-0000-0000-0002-000000000004','00000000-0000-0000-0000-000000000001','Tara','Innes','386-339-1901','tara.innes.plantation@circleoflife.demo','administrator','active','2013-06-01',3500,true),
  ('50000004-0000-0000-0000-000000000002',NULL,'00000000-0000-0000-0002-000000000004','00000000-0000-0000-0000-000000000001','Uma','Jensen','386-339-1902','uma.jensen.plantation@circleoflife.demo','lpn','active','2017-03-01',2800,true),
  ('50000004-0000-0000-0000-000000000003',NULL,'00000000-0000-0000-0002-000000000004','00000000-0000-0000-0000-000000000001','Victor','Kline','386-339-1903','victor.kline.plantation@circleoflife.demo','cna','active','2021-07-01',1650,true),
  ('50000004-0000-0000-0000-000000000004',NULL,'00000000-0000-0000-0002-000000000004','00000000-0000-0000-0000-000000000001','Wendy','Lopez','386-339-1904','wendy.lopez.plantation@circleoflife.demo','cna','active','2022-09-01',1650,true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO staff_certifications (id, staff_id, facility_id, organization_id, certification_type, certification_name, issuing_authority, certificate_number, issue_date, expiration_date, status) VALUES
  ('51000004-0000-0000-0000-000000000001','50000004-0000-0000-0000-000000000002','00000000-0000-0000-0002-000000000004','00000000-0000-0000-0000-000000000001','lpn_license','Licensed Practical Nurse','Florida Board of Nursing','LPN-PL-2017','2017-03-01','2027-03-01','active'),
  ('51000004-0000-0000-0000-000000000002','50000004-0000-0000-0000-000000000003','00000000-0000-0000-0002-000000000004','00000000-0000-0000-0000-000000000001','cna_certification','Certified Nursing Assistant','Florida DOEA','CNA-PL-2021','2021-07-01','2025-07-01','active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO care_plans (id, resident_id, facility_id, organization_id, version, status, effective_date, review_due_date, notes) VALUES
  ('60000004-0000-0000-0000-000000000001','c0000004-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000004','00000000-0000-0000-0000-000000000001',1,'active','2024-04-15','2026-08-01','Plantation — mobility and pain plan.'),
  ('60000004-0000-0000-0000-000000000002','c0000004-0000-0000-0000-000000000003','00000000-0000-0000-0002-000000000004','00000000-0000-0000-0000-000000000001',1,'active','2024-09-01','2026-05-15','Plantation — Parkinson''s mobility.')
ON CONFLICT (id) DO NOTHING;

INSERT INTO care_plan_items (id, care_plan_id, resident_id, facility_id, organization_id, category, title, description, assistance_level, frequency, goal, interventions, sort_order) VALUES
  ('61000004-0000-0000-0000-000000000001','60000004-0000-0000-0000-000000000001','c0000004-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000004','00000000-0000-0000-0000-000000000001','pain_management','Joint pain management','Scheduled PRN per orders.','limited_assist','PRN','Pain < 4/10',ARRAY['Ice after PT','Positioning'],1),
  ('61000004-0000-0000-0000-000000000002','60000004-0000-0000-0000-000000000002','c0000004-0000-0000-0000-000000000003','00000000-0000-0000-0002-000000000004','00000000-0000-0000-0000-000000000001','mobility','Transfer safety','Full assist for transfers.','extensive_assist','Every transfer','No injury',ARRAY['Gait belt','Two-person assist'],1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO resident_medications (id, resident_id, facility_id, organization_id, medication_name, generic_name, strength, form, route, frequency, scheduled_times, instructions, indication, prescriber_name, status, start_date, order_date) VALUES
  ('70000004-0000-0000-0000-000000000001','c0000004-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000004','00000000-0000-0000-0000-000000000001','Acetaminophen','Acetaminophen','500mg','Tablet','oral','prn',ARRAY[]::time[],'PRN mild pain','OA','Dr. Hayes','active','2024-04-01','2024-04-01'),
  ('70000004-0000-0000-0000-000000000002','c0000004-0000-0000-0000-000000000002','00000000-0000-0000-0002-000000000004','00000000-0000-0000-0000-000000000001','Omeprazole','Omeprazole','20mg','Capsule','oral','daily',ARRAY['07:00']::time[],'Before breakfast','GERD','Dr. Rivera','active','2023-10-12','2023-10-12'),
  ('70000004-0000-0000-0000-000000000003','c0000004-0000-0000-0000-000000000003','00000000-0000-0000-0002-000000000004','00000000-0000-0000-0000-000000000001','Carbidopa/Levodopa','Carbidopa/Levodopa','25/100mg','Tablet','oral','tid',ARRAY['07:00','13:00','19:00']::time[],'With meals','Parkinson''s','Dr. Hayes','active','2024-08-15','2024-08-15'),
  ('70000004-0000-0000-0000-000000000004','c0000004-0000-0000-0000-000000000004','00000000-0000-0000-0002-000000000004','00000000-0000-0000-0000-000000000001','Multivitamin','Multivitamin','1 tab','Tablet','oral','daily',ARRAY['08:00']::time[],'With breakfast','General','Dr. Crawford','active','2025-03-01','2025-03-01')
ON CONFLICT (id) DO NOTHING;

INSERT INTO daily_logs (id, resident_id, facility_id, organization_id, log_date, shift, logged_by, general_notes, mood, temperature, blood_pressure_systolic, blood_pressure_diastolic, pulse, oxygen_saturation) VALUES
  ('80000004-0000-0000-0000-000000000001','c0000004-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000004','00000000-0000-0000-0000-000000000001',CURRENT_DATE,'day','a0000000-0000-0000-0000-000000000004','Ambulated with cane; no complaints of pain.','Content',98.0,130,82,74,97.0),
  ('80000004-0000-0000-0000-000000000002','c0000004-0000-0000-0000-000000000003','00000000-0000-0000-0002-000000000004','00000000-0000-0000-0000-000000000001',CURRENT_DATE,'day','a0000000-0000-0000-0000-000000000005','Tremor moderate; participated in PT stretches.','Calm',98.2,122,74,68,97.5)
ON CONFLICT (id) DO NOTHING;

INSERT INTO activities (id, facility_id, organization_id, name, description, default_day_of_week, default_start_time, default_duration_minutes, facilitator, is_recurring) VALUES
  ('ac000004-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000004','00000000-0000-0000-0000-000000000001','Cornhole','Outdoor lawn games',ARRAY[5,6],'16:00',45,'Victor Kline',true),
  ('ac000004-0000-0000-0000-000000000002','00000000-0000-0000-0002-000000000004','00000000-0000-0000-0000-000000000001','Book Club','Chapter discussion',ARRAY[2],'15:00',60,'Tara Innes',true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO activity_sessions (id, activity_id, facility_id, organization_id, session_date, start_time, end_time, facilitator_name, cancelled) VALUES
  ('a5000004-0000-0000-0000-000000000001','ac000004-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000004','00000000-0000-0000-0000-000000000001',CURRENT_DATE,(CURRENT_DATE + '16:00'::time)::timestamptz,(CURRENT_DATE + '16:45'::time)::timestamptz,'Victor Kline',false),
  ('a5000004-0000-0000-0000-000000000002','ac000004-0000-0000-0000-000000000002','00000000-0000-0000-0002-000000000004','00000000-0000-0000-0000-000000000001',CURRENT_DATE + 3,(CURRENT_DATE + 3 + '15:00'::time)::timestamptz,(CURRENT_DATE + 3 + '16:00'::time)::timestamptz,'Tara Innes',false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO incidents (id, resident_id, facility_id, organization_id, incident_number, category, severity, status, occurred_at, discovered_at, shift, location_description, description, immediate_actions, contributing_factors, fall_witnessed, injury_occurred, reported_by, nurse_notified, nurse_notified_at, administrator_notified, family_notified, family_notified_at) VALUES
  ('90000004-0000-0000-0000-000000000001','c0000004-0000-0000-0000-000000000003','00000000-0000-0000-0002-000000000004','00000000-0000-0000-0000-000000000001',
   'PLT-2026-0001','skin_integrity','level_1','resolved',
   now() - interval '6 days', now() - interval '6 days','day',
   'Common room — transfer from wheelchair',
   'Minor skin tear on forearm during transfer; cleaned and dressed per protocol. MD notified.',
   ARRAY['Pressure redistribution','Wound care supplies'],
   ARRAY['Fragile skin'],false,false,'a0000000-0000-0000-0000-000000000004',
   true, now() - interval '6 days',true,true, now() - interval '6 days')
ON CONFLICT (id) DO NOTHING;

INSERT INTO rate_schedules (id, facility_id, organization_id, name, effective_date, base_rate_private, base_rate_semi_private, care_surcharge_level_1, care_surcharge_level_2, care_surcharge_level_3, community_fee, respite_daily_rate) VALUES
  ('b3000004-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000004','00000000-0000-0000-0000-000000000001','2025 Standard — Plantation','2025-01-01',425000,375000,0,35000,75000,250000,17500)
ON CONFLICT (id) DO NOTHING;

INSERT INTO resident_payers (id, resident_id, facility_id, organization_id, payer_type, is_primary, payer_name, effective_date) VALUES
  ('b4000004-0000-0000-0000-000000000001','c0000004-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000004','00000000-0000-0000-0000-000000000001','private_pay',true,'Paul Ingram','2024-04-01'),
  ('b4000004-0000-0000-0000-000000000002','c0000004-0000-0000-0000-000000000003','00000000-0000-0000-0002-000000000004','00000000-0000-0000-0000-000000000001','private_pay',true,'Sofia Gomez','2024-08-15')
ON CONFLICT (id) DO NOTHING;

INSERT INTO invoices (id, resident_id, facility_id, organization_id, entity_id, invoice_number, invoice_date, due_date, period_start, period_end, status, subtotal, total, amount_paid, balance_due) VALUES
  ('b5000004-0000-0000-0000-000000000001','c0000004-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000004','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0001-000000000004','PLT-2026-03-001','2026-03-01','2026-03-15','2026-03-01','2026-03-31','sent',460000,460000,0,460000),
  ('b5000004-0000-0000-0000-000000000002','c0000004-0000-0000-0000-000000000003','00000000-0000-0000-0002-000000000004','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0001-000000000004','PLT-2026-03-002','2026-03-01','2026-03-15','2026-03-01','2026-03-31','paid',500000,500000,500000,0)
ON CONFLICT (id) DO NOTHING;

INSERT INTO invoice_line_items (id, invoice_id, organization_id, line_type, description, quantity, unit_price, total, sort_order) VALUES
  ('b6000004-0000-0000-0000-000000000001','b5000004-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','room_and_board','Private Room — Monthly Rate',1,425000,425000,1),
  ('b6000004-0000-0000-0000-000000000002','b5000004-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','care_surcharge','Level 2 Care Surcharge',1,35000,35000,2),
  ('b6000004-0000-0000-0000-000000000003','b5000004-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','room_and_board','Private Room — Monthly Rate',1,425000,425000,1),
  ('b6000004-0000-0000-0000-000000000004','b5000004-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','care_surcharge','Level 3 Care Surcharge',1,75000,75000,2)
ON CONFLICT (id) DO NOTHING;

INSERT INTO payments (id, resident_id, facility_id, organization_id, entity_id, invoice_id, payment_date, amount, payment_method, reference_number, payer_name) VALUES
  ('b7000004-0000-0000-0000-000000000001','c0000004-0000-0000-0000-000000000003','00000000-0000-0000-0002-000000000004','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0001-000000000004','b5000004-0000-0000-0000-000000000002','2026-03-09',500000,'ach','ACH-PLT-1','Sofia Gomez')
ON CONFLICT (id) DO NOTHING;

INSERT INTO schedules (id, facility_id, organization_id, week_start_date, status, published_at) VALUES
  ('b8000004-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000004','00000000-0000-0000-0000-000000000001', date_trunc('week', CURRENT_DATE)::date, 'published', now() - interval '2 days')
ON CONFLICT (id) DO NOTHING;

INSERT INTO shift_assignments (id, schedule_id, staff_id, facility_id, organization_id, shift_date, shift_type, unit_id, status) VALUES
  ('b9000004-0000-0000-0000-000000000001','b8000004-0000-0000-0000-000000000001','50000004-0000-0000-0000-000000000003','00000000-0000-0000-0002-000000000004','00000000-0000-0000-0000-000000000001',CURRENT_DATE,'day','10000004-0000-0000-0000-000000000001','confirmed'),
  ('b9000004-0000-0000-0000-000000000002','b8000004-0000-0000-0000-000000000001','50000004-0000-0000-0000-000000000004','00000000-0000-0000-0002-000000000004','00000000-0000-0000-0000-000000000001',CURRENT_DATE,'day','10000004-0000-0000-0000-000000000001','confirmed')
ON CONFLICT (id) DO NOTHING;

INSERT INTO time_records (id, staff_id, shift_assignment_id, facility_id, organization_id, clock_in, clock_out, clock_in_method, clock_out_method, scheduled_hours, actual_hours, regular_hours, approved) VALUES
  ('ba000004-0000-0000-0000-000000000001','50000004-0000-0000-0000-000000000003','b9000004-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000004','00000000-0000-0000-0000-000000000001',(CURRENT_DATE + '06:59'::time)::timestamptz,(CURRENT_DATE + '15:03'::time)::timestamptz,'mobile_app','mobile_app',8.0,8.07,8.07,false),
  ('ba000004-0000-0000-0000-000000000002','50000004-0000-0000-0000-000000000004','b9000004-0000-0000-0000-000000000002','00000000-0000-0000-0002-000000000004','00000000-0000-0000-0000-000000000001',(CURRENT_DATE + '07:01'::time)::timestamptz,(CURRENT_DATE + '15:00'::time)::timestamptz,'mobile_app','mobile_app',8.0,7.98,7.98,false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO staffing_ratio_snapshots (id, facility_id, organization_id, shift, residents_present, staff_on_duty, ratio, required_ratio, is_compliant, staff_detail) VALUES
  ('bb000004-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000004','00000000-0000-0000-0000-000000000001','day',4,2,2.0,5.00,true,'[{"name":"Victor Kline","role":"cna"},{"name":"Wendy Lopez","role":"cna"}]')
ON CONFLICT (id) DO NOTHING;

INSERT INTO census_daily_log (id, facility_id, organization_id, log_date, total_licensed_beds, occupied_beds, available_beds, hold_beds, maintenance_beds, occupancy_rate) VALUES
  ('cd000004-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000004','00000000-0000-0000-0000-000000000001',CURRENT_DATE,64,4,59,1,0,0.0625)
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- FACILITY 005 — Grande Cypress ALF
-- =============================================================================
INSERT INTO units (id, facility_id, organization_id, name, floor_number, sort_order) VALUES
  ('10000005-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000005','00000000-0000-0000-0000-000000000001','Cypress Hall',1,1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO rooms (id, facility_id, organization_id, unit_id, room_number, room_type, max_occupancy, is_ada_accessible, near_nursing_station) VALUES
  ('d0000005-0000-0000-0000-000000000101','00000000-0000-0000-0002-000000000005','00000000-0000-0000-0000-000000000001','10000005-0000-0000-0000-000000000001','C101','private',1,true,true),
  ('d0000005-0000-0000-0000-000000000102','00000000-0000-0000-0002-000000000005','00000000-0000-0000-0000-000000000001','10000005-0000-0000-0000-000000000001','C102','private',1,false,false),
  ('d0000005-0000-0000-0000-000000000103','00000000-0000-0000-0002-000000000005','00000000-0000-0000-0000-000000000001','10000005-0000-0000-0000-000000000001','C103','semi_private',2,false,false),
  ('d0000005-0000-0000-0000-000000000104','00000000-0000-0000-0002-000000000005','00000000-0000-0000-0000-000000000001','10000005-0000-0000-0000-000000000001','C104','private',1,true,false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO beds (id, room_id, facility_id, organization_id, bed_label, bed_type, status) VALUES
  ('b0000005-0000-0000-0000-000000000101','d0000005-0000-0000-0000-000000000101','00000000-0000-0000-0002-000000000005','00000000-0000-0000-0000-000000000001','C101-A','alf_intermediate','occupied'),
  ('b0000005-0000-0000-0000-000000000102','d0000005-0000-0000-0000-000000000102','00000000-0000-0000-0002-000000000005','00000000-0000-0000-0000-000000000001','C102-A','alf_intermediate','occupied'),
  ('b0000005-0000-0000-0000-000000000103','d0000005-0000-0000-0000-000000000103','00000000-0000-0000-0002-000000000005','00000000-0000-0000-0000-000000000001','C103-A','alf_intermediate','occupied'),
  ('b0000005-0000-0000-0000-000000000104','d0000005-0000-0000-0000-000000000104','00000000-0000-0000-0002-000000000005','00000000-0000-0000-0000-000000000001','C104-A','alf_intermediate','occupied')
ON CONFLICT (id) DO NOTHING;

INSERT INTO residents (id, facility_id, organization_id, bed_id, first_name, last_name, preferred_name, date_of_birth, gender, ssn_last_four, status, acuity_level, admission_date, primary_physician_name, primary_physician_phone, primary_diagnosis, diagnosis_list, allergy_list, diet_order, code_status, ambulatory, assistive_device, fall_risk_level, elopement_risk, wandering_risk, primary_payer, monthly_base_rate, monthly_care_surcharge, monthly_total_rate, rate_effective_date, responsible_party_name, responsible_party_relationship, responsible_party_phone, emergency_contact_1_name, emergency_contact_1_relationship, emergency_contact_1_phone, preferred_wake_time, preferred_bed_time) VALUES
  ('c0000005-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000005','00000000-0000-0000-0000-000000000001','b0000005-0000-0000-0000-000000000101','Yvonne','Marsh',NULL,'1943-10-11','female','5500','active','level_2','2024-05-01','Dr. Hayes','386-755-1122','Hypothyroidism',ARRAY['Hypothyroidism'],ARRAY[]::text[],'Regular','full_code',true,NULL,'moderate',false,false,'ltc_insurance',425000,35000,460000,'2024-05-01','Yvonne Marsh Jr','Son','386-555-0501','Yvonne Marsh Jr','Son','386-555-0501','07:00','21:00'),
  ('c0000005-0000-0000-0000-000000000002','00000000-0000-0000-0002-000000000005','00000000-0000-0000-0000-000000000001','b0000005-0000-0000-0000-000000000102','Zach','Noble',NULL,'1947-02-02','male','6611','active','level_1','2023-11-20','Dr. Rivera','386-755-2233','BPH',ARRAY['BPH'],ARRAY[]::text[],'Regular','full_code',true,NULL,'standard',false,false,'private_pay',425000,0,425000,'2023-11-20','Zach Noble','Wife','386-555-0502','Zach Noble','Wife','386-555-0502','06:30','22:00'),
  ('c0000005-0000-0000-0000-000000000003','00000000-0000-0000-0002-000000000005','00000000-0000-0000-0000-000000000001','b0000005-0000-0000-0000-000000000103','Amy','Ortega',NULL,'1939-07-14','female','7722','active','level_3','2024-09-10','Dr. Hayes','386-755-1122','Alzheimer''s disease',ARRAY['Alzheimer''s disease'],ARRAY['Sulfa'],'Mechanical soft','full_code',true,'Walker','high',false,true,'medicaid_oss',425000,75000,500000,'2024-09-10','Amy Ortega','Son','386-555-0503','Amy Ortega','Son','386-555-0503','08:00','19:00'),
  ('c0000005-0000-0000-0000-000000000004','00000000-0000-0000-0002-000000000005','00000000-0000-0000-0000-000000000001','b0000005-0000-0000-0000-000000000104','Bill','Parks',NULL,'1952-11-30','male','8833','active','level_1','2025-02-15','Dr. Crawford','386-755-3344','Depression',ARRAY['Depression'],ARRAY[]::text[],'Regular','full_code',true,NULL,'standard',false,false,'private_pay',425000,0,425000,'2025-02-15','Bill Parks','Sister','386-555-0504','Bill Parks','Sister','386-555-0504','07:30','21:30')
ON CONFLICT (id) DO NOTHING;

UPDATE beds SET current_resident_id = 'c0000005-0000-0000-0000-000000000001' WHERE id = 'b0000005-0000-0000-0000-000000000101';
UPDATE beds SET current_resident_id = 'c0000005-0000-0000-0000-000000000002' WHERE id = 'b0000005-0000-0000-0000-000000000102';
UPDATE beds SET current_resident_id = 'c0000005-0000-0000-0000-000000000003' WHERE id = 'b0000005-0000-0000-0000-000000000103';
UPDATE beds SET current_resident_id = 'c0000005-0000-0000-0000-000000000004' WHERE id = 'b0000005-0000-0000-0000-000000000104';

INSERT INTO staff (id, user_id, facility_id, organization_id, first_name, last_name, phone, email, staff_role, employment_status, hire_date, hourly_rate, is_full_time) VALUES
  ('50000005-0000-0000-0000-000000000001',NULL,'00000000-0000-0000-0002-000000000005','00000000-0000-0000-0000-000000000001','Cora','Quinn','386-339-2001','cora.quinn.grande@circleoflife.demo','administrator','active','2014-08-01',3450,true),
  ('50000005-0000-0000-0000-000000000002',NULL,'00000000-0000-0000-0002-000000000005','00000000-0000-0000-0000-000000000001','Derek','Rhodes','386-339-2002','derek.rhodes.grande@circleoflife.demo','lpn','active','2019-01-01',2700,true),
  ('50000005-0000-0000-0000-000000000003',NULL,'00000000-0000-0000-0002-000000000005','00000000-0000-0000-0000-000000000001','Elle','Snow','386-339-2003','elle.snow.grande@circleoflife.demo','cna','active','2020-04-01',1650,true),
  ('50000005-0000-0000-0000-000000000004',NULL,'00000000-0000-0000-0002-000000000005','00000000-0000-0000-0000-000000000001','Finn','Todd','386-339-2004','finn.todd.grande@circleoflife.demo','cna','active','2023-08-01',1650,true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO staff_certifications (id, staff_id, facility_id, organization_id, certification_type, certification_name, issuing_authority, certificate_number, issue_date, expiration_date, status) VALUES
  ('51000005-0000-0000-0000-000000000001','50000005-0000-0000-0000-000000000002','00000000-0000-0000-0002-000000000005','00000000-0000-0000-0000-000000000001','lpn_license','Licensed Practical Nurse','Florida Board of Nursing','LPN-GC-2019','2019-01-01','2027-01-01','active'),
  ('51000005-0000-0000-0000-000000000002','50000005-0000-0000-0000-000000000003','00000000-0000-0000-0002-000000000005','00000000-0000-0000-0000-000000000001','cna_certification','Certified Nursing Assistant','Florida DOEA','CNA-GC-2020','2020-04-01','2024-04-01','expired')
ON CONFLICT (id) DO NOTHING;

INSERT INTO care_plans (id, resident_id, facility_id, organization_id, version, status, effective_date, review_due_date, notes) VALUES
  ('60000005-0000-0000-0000-000000000001','c0000005-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000005','00000000-0000-0000-0000-000000000001',1,'active','2024-05-15','2026-09-01','Grande Cypress — thyroid monitoring.'),
  ('60000005-0000-0000-0000-000000000002','c0000005-0000-0000-0000-000000000003','00000000-0000-0000-0002-000000000005','00000000-0000-0000-0000-000000000001',1,'active','2024-10-01','2026-06-01','Grande Cypress — dementia safety.')
ON CONFLICT (id) DO NOTHING;

INSERT INTO care_plan_items (id, care_plan_id, resident_id, facility_id, organization_id, category, title, description, assistance_level, frequency, goal, interventions, sort_order) VALUES
  ('61000005-0000-0000-0000-000000000001','60000005-0000-0000-0000-000000000001','c0000005-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000005','00000000-0000-0000-0000-000000000001','medication_assistance','Levothyroxine compliance','AM fasting labs monthly.','limited_assist','Daily','TSH stable',ARRAY['Give 30 min before breakfast'],1),
  ('61000005-0000-0000-0000-000000000002','60000005-0000-0000-0000-000000000002','c0000005-0000-0000-0000-000000000003','00000000-0000-0000-0002-000000000005','00000000-0000-0000-0000-000000000001','fall_prevention','High fall risk','Supervision during toileting.','extensive_assist','Every shift','No falls',ARRAY['Non-skid footwear','Call light within reach'],1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO resident_medications (id, resident_id, facility_id, organization_id, medication_name, generic_name, strength, form, route, frequency, scheduled_times, instructions, indication, prescriber_name, status, start_date, order_date) VALUES
  ('70000005-0000-0000-0000-000000000001','c0000005-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000005','00000000-0000-0000-0000-000000000001','Levothyroxine','Levothyroxine','75mcg','Tablet','oral','daily',ARRAY['07:00']::time[],'30 min before breakfast','Hypothyroidism','Dr. Hayes','active','2024-05-01','2024-05-01'),
  ('70000005-0000-0000-0000-000000000002','c0000005-0000-0000-0000-000000000002','00000000-0000-0000-0002-000000000005','00000000-0000-0000-0000-000000000001','Tamsulosin','Tamsulosin','0.4mg','Capsule','oral','daily',ARRAY['21:00']::time[],'After dinner','BPH','Dr. Rivera','active','2023-11-20','2023-11-20'),
  ('70000005-0000-0000-0000-000000000003','c0000005-0000-0000-0000-000000000003','00000000-0000-0000-0002-000000000005','00000000-0000-0000-0000-000000000001','Memantine','Memantine','10mg','Tablet','oral','bid',ARRAY['08:00','20:00']::time[],'With meals','Dementia','Dr. Hayes','active','2024-09-10','2024-09-10'),
  ('70000005-0000-0000-0000-000000000004','c0000005-0000-0000-0000-000000000004','00000000-0000-0000-0002-000000000005','00000000-0000-0000-0000-000000000001','Sertraline','Sertraline','50mg','Tablet','oral','daily',ARRAY['09:00']::time[],'With food','Depression','Dr. Crawford','active','2025-02-15','2025-02-15')
ON CONFLICT (id) DO NOTHING;

INSERT INTO daily_logs (id, resident_id, facility_id, organization_id, log_date, shift, logged_by, general_notes, mood, temperature, blood_pressure_systolic, blood_pressure_diastolic, pulse, oxygen_saturation) VALUES
  ('80000005-0000-0000-0000-000000000001','c0000005-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000005','00000000-0000-0000-0000-000000000001',CURRENT_DATE,'day','a0000000-0000-0000-0000-000000000004','Levothyroxine given 30 min before breakfast per order.','Alert',97.9,118,74,72,98.0),
  ('80000005-0000-0000-0000-000000000002','c0000005-0000-0000-0000-000000000003','00000000-0000-0000-0002-000000000005','00000000-0000-0000-0000-000000000001',CURRENT_DATE,'day','a0000000-0000-0000-0000-000000000005','Redirected from exit twice; calm after music.','Restless',98.0,124,76,78,97.5)
ON CONFLICT (id) DO NOTHING;

INSERT INTO activities (id, facility_id, organization_id, name, description, default_day_of_week, default_start_time, default_duration_minutes, facilitator, is_recurring) VALUES
  ('ac000005-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000005','00000000-0000-0000-0000-000000000001','Chair Yoga','Seated stretching',ARRAY[1,3,5],'10:30',35,'Elle Snow',true),
  ('ac000005-0000-0000-0000-000000000002','00000000-0000-0000-0002-000000000005','00000000-0000-0000-0000-000000000001','Ice Cream Social','Monthly treat cart',ARRAY[6],'15:00',45,'Cora Quinn',true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO activity_sessions (id, activity_id, facility_id, organization_id, session_date, start_time, end_time, facilitator_name, cancelled) VALUES
  ('a5000005-0000-0000-0000-000000000001','ac000005-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000005','00000000-0000-0000-0000-000000000001',CURRENT_DATE,(CURRENT_DATE + '10:30'::time)::timestamptz,(CURRENT_DATE + '11:05'::time)::timestamptz,'Elle Snow',false),
  ('a5000005-0000-0000-0000-000000000002','ac000005-0000-0000-0000-000000000002','00000000-0000-0000-0002-000000000005','00000000-0000-0000-0000-000000000001',CURRENT_DATE + 4,(CURRENT_DATE + 4 + '15:00'::time)::timestamptz,(CURRENT_DATE + 4 + '15:45'::time)::timestamptz,'Cora Quinn',false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO incidents (id, resident_id, facility_id, organization_id, incident_number, category, severity, status, occurred_at, discovered_at, shift, location_description, description, immediate_actions, contributing_factors, fall_witnessed, injury_occurred, reported_by, nurse_notified, nurse_notified_at, administrator_notified, family_notified, family_notified_at) VALUES
  ('90000005-0000-0000-0000-000000000001','c0000005-0000-0000-0000-000000000004','00000000-0000-0000-0002-000000000005','00000000-0000-0000-0000-000000000001',
   'GCY-2026-0001','other','level_1','resolved',
   now() - interval '2 days', now() - interval '2 days','evening',
   'Dining room',
   'Verbal outburst during dinner seating; resident calmed with redirection to private dining.',
   ARRAY['Offered alternate seating','1:1 until calm'],
   ARRAY['Crowded dining timing'],false,false,'a0000000-0000-0000-0000-000000000005',
   true, now() - interval '2 days',true,false,NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO rate_schedules (id, facility_id, organization_id, name, effective_date, base_rate_private, base_rate_semi_private, care_surcharge_level_1, care_surcharge_level_2, care_surcharge_level_3, community_fee, respite_daily_rate) VALUES
  ('b3000005-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000005','00000000-0000-0000-0000-000000000001','2025 Standard — Grande Cypress','2025-01-01',425000,375000,0,35000,75000,250000,17500)
ON CONFLICT (id) DO NOTHING;

INSERT INTO resident_payers (id, resident_id, facility_id, organization_id, payer_type, is_primary, payer_name, effective_date) VALUES
  ('b4000005-0000-0000-0000-000000000001','c0000005-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000005','00000000-0000-0000-0000-000000000001','ltc_insurance',true,'Mutual of Omaha','2024-05-01'),
  ('b4000005-0000-0000-0000-000000000002','c0000005-0000-0000-0000-000000000003','00000000-0000-0000-0002-000000000005','00000000-0000-0000-0000-000000000001','medicaid_oss',true,'Florida Medicaid','2024-09-10')
ON CONFLICT (id) DO NOTHING;

INSERT INTO invoices (id, resident_id, facility_id, organization_id, entity_id, invoice_number, invoice_date, due_date, period_start, period_end, status, subtotal, total, amount_paid, balance_due) VALUES
  ('b5000005-0000-0000-0000-000000000001','c0000005-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000005','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0001-000000000005','GCY-2026-03-001','2026-03-01','2026-03-15','2026-03-01','2026-03-31','partial',460000,460000,200000,260000),
  ('b5000005-0000-0000-0000-000000000002','c0000005-0000-0000-0000-000000000003','00000000-0000-0000-0002-000000000005','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0001-000000000005','GCY-2026-03-002','2026-03-01','2026-03-15','2026-03-01','2026-03-31','sent',500000,500000,0,500000)
ON CONFLICT (id) DO NOTHING;

INSERT INTO invoice_line_items (id, invoice_id, organization_id, line_type, description, quantity, unit_price, total, sort_order) VALUES
  ('b6000005-0000-0000-0000-000000000001','b5000005-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','room_and_board','Private Room — Monthly Rate',1,425000,425000,1),
  ('b6000005-0000-0000-0000-000000000002','b5000005-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','care_surcharge','Level 2 Care Surcharge',1,35000,35000,2),
  ('b6000005-0000-0000-0000-000000000003','b5000005-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','room_and_board','Private Room — Monthly Rate',1,425000,425000,1),
  ('b6000005-0000-0000-0000-000000000004','b5000005-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','care_surcharge','Level 3 Care Surcharge',1,75000,75000,2)
ON CONFLICT (id) DO NOTHING;

INSERT INTO payments (id, resident_id, facility_id, organization_id, entity_id, invoice_id, payment_date, amount, payment_method, reference_number, payer_name) VALUES
  ('b7000005-0000-0000-0000-000000000001','c0000005-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000005','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0001-000000000005','b5000005-0000-0000-0000-000000000001','2026-03-11',200000,'ach','ACH-GCY-1','Mutual of Omaha')
ON CONFLICT (id) DO NOTHING;

INSERT INTO schedules (id, facility_id, organization_id, week_start_date, status, published_at) VALUES
  ('b8000005-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000005','00000000-0000-0000-0000-000000000001', date_trunc('week', CURRENT_DATE)::date, 'published', now() - interval '3 days')
ON CONFLICT (id) DO NOTHING;

INSERT INTO shift_assignments (id, schedule_id, staff_id, facility_id, organization_id, shift_date, shift_type, unit_id, status) VALUES
  ('b9000005-0000-0000-0000-000000000001','b8000005-0000-0000-0000-000000000001','50000005-0000-0000-0000-000000000003','00000000-0000-0000-0002-000000000005','00000000-0000-0000-0000-000000000001',CURRENT_DATE,'day','10000005-0000-0000-0000-000000000001','confirmed'),
  ('b9000005-0000-0000-0000-000000000002','b8000005-0000-0000-0000-000000000001','50000005-0000-0000-0000-000000000004','00000000-0000-0000-0002-000000000005','00000000-0000-0000-0000-000000000001',CURRENT_DATE,'day','10000005-0000-0000-0000-000000000001','confirmed')
ON CONFLICT (id) DO NOTHING;

INSERT INTO time_records (id, staff_id, shift_assignment_id, facility_id, organization_id, clock_in, clock_out, clock_in_method, clock_out_method, scheduled_hours, actual_hours, regular_hours, approved) VALUES
  ('ba000005-0000-0000-0000-000000000001','50000005-0000-0000-0000-000000000003','b9000005-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000005','00000000-0000-0000-0000-000000000001',(CURRENT_DATE + '07:00'::time)::timestamptz,(CURRENT_DATE + '15:05'::time)::timestamptz,'mobile_app','mobile_app',8.0,8.08,8.08,false),
  ('ba000005-0000-0000-0000-000000000002','50000005-0000-0000-0000-000000000004','b9000005-0000-0000-0000-000000000002','00000000-0000-0000-0002-000000000005','00000000-0000-0000-0000-000000000001',(CURRENT_DATE + '06:57'::time)::timestamptz,(CURRENT_DATE + '15:02'::time)::timestamptz,'kiosk','kiosk',8.0,8.08,8.08,true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO staffing_ratio_snapshots (id, facility_id, organization_id, shift, residents_present, staff_on_duty, ratio, required_ratio, is_compliant, staff_detail) VALUES
  ('bb000005-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000005','00000000-0000-0000-0000-000000000001','day',4,2,2.0,5.00,true,'[{"name":"Elle Snow","role":"cna"},{"name":"Finn Todd","role":"cna"}]')
ON CONFLICT (id) DO NOTHING;

INSERT INTO census_daily_log (id, facility_id, organization_id, log_date, total_licensed_beds, occupied_beds, available_beds, hold_beds, maintenance_beds, occupancy_rate) VALUES
  ('cd000005-0000-0000-0000-000000000001','00000000-0000-0000-0002-000000000005','00000000-0000-0000-0000-000000000001',CURRENT_DATE,54,4,49,1,0,0.0741)
ON CONFLICT (id) DO NOTHING;
