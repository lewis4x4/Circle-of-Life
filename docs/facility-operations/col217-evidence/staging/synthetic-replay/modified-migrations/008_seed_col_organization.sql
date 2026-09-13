-- COL org / entities / facilities (spec 00-foundation) — fixed UUIDs for local + remote parity

INSERT INTO organizations (id, name, dba_name, primary_contact_name, primary_contact_email, primary_contact_phone, address_line_1, city, state, zip)
  VALUES ('00000000-0000-0000-0000-000000000001', 'Circle of Life Assisted Living Communities', 'Circle of Life', 'Synthetic full_name b95b8fc4b8', 'synthetic-106d22b51a@example.invalid', '202-555-0149', 'Synthetic address_line_1 b568c93e59', 'Synthetic city 508a9d8f32', 'FL', '00000');

INSERT INTO entities (id, organization_id, name, dba_name, entity_type, fein, years_ownership, years_management, address_line_1, city, state, zip)
  VALUES ('00000000-0000-0000-0001-000000000001', '00000000-0000-0000-0000-000000000001', 'Pine House, Inc.', 'Oakridge ALF', 'Inc.', '00-2030783', 12, 12, 'Synthetic address_line_1 a63bec9a91', 'Synthetic city 74831bf043', 'FL', '00000'),
('00000000-0000-0000-0001-000000000002', '00000000-0000-0000-0000-000000000001', 'Smith & Sorensen LLC', 'Rising Oaks ALF', 'LLC', '00-9588161', 11, 11, 'Synthetic address_line_1 10fa254307', 'Synthetic city e44d10f249', 'FL', '00000'),
('00000000-0000-0000-0001-000000000003', '00000000-0000-0000-0000-000000000001', 'Sorensen, Smith & Bay, LLC', 'Homewood Lodge, ALF', 'LLC', '00-5170873', 13, 13, 'Synthetic address_line_1 40a1bfe961', 'Synthetic city 74831bf043', 'FL', '00000'),
('00000000-0000-0000-0001-000000000004', '00000000-0000-0000-0000-000000000001', 'The Plantation on Summers, LLC', 'Plantation ALF', 'LLC', '00-5423967', 9, 9, 'Synthetic address_line_1 3236fdaf37', 'Synthetic city 508a9d8f32', 'FL', '00000'),
('00000000-0000-0000-0001-000000000005', '00000000-0000-0000-0000-000000000001', 'Grande Cypress ALF LLC', NULL, 'LLC', '00-3336218', 5, 5, 'Synthetic address_line_1 128bd287c0', 'Synthetic city 508a9d8f32', 'FL', '00000');

INSERT INTO facilities (id, entity_id, organization_id, name, license_type, address_line_1, city, state, zip, county, phone, email, total_licensed_beds)
  VALUES ('00000000-0000-0000-0002-000000000001', '00000000-0000-0000-0001-000000000001', '00000000-0000-0000-0000-000000000001', 'Oakridge ALF', 'alf_intermediate', 'Synthetic address_line_1 a63bec9a91', 'Synthetic city 74831bf043', 'FL', '00000', 'Lafayette', '202-555-0149', 'synthetic-106d22b51a@example.invalid', 52),
('00000000-0000-0000-0002-000000000002', '00000000-0000-0000-0001-000000000002', '00000000-0000-0000-0000-000000000001', 'Rising Oaks ALF', 'alf_intermediate', 'Synthetic address_line_1 10fa254307', 'Synthetic city e44d10f249', 'FL', '00000', 'Suwannee', '202-555-0149', 'synthetic-106d22b51a@example.invalid', 52),
('00000000-0000-0000-0002-000000000003', '00000000-0000-0000-0001-000000000003', '00000000-0000-0000-0000-000000000001', 'Homewood Lodge ALF', 'alf_intermediate', 'Synthetic address_line_1 40a1bfe961', 'Synthetic city 74831bf043', 'FL', '00000', 'Lafayette', '202-555-0149', 'synthetic-106d22b51a@example.invalid', 36),
('00000000-0000-0000-0002-000000000004', '00000000-0000-0000-0001-000000000004', '00000000-0000-0000-0000-000000000001', 'Plantation ALF', 'alf_intermediate', 'Synthetic address_line_1 3236fdaf37', 'Synthetic city 508a9d8f32', 'FL', '00000', 'Columbia', '202-555-0149', 'synthetic-106d22b51a@example.invalid', 64),
('00000000-0000-0000-0002-000000000005', '00000000-0000-0000-0001-000000000005', '00000000-0000-0000-0000-000000000001', 'Grande Cypress ALF', 'alf_intermediate', 'Synthetic address_line_1 128bd287c0', 'Synthetic city 508a9d8f32', 'FL', '00000', 'Columbia', '202-555-0149', 'synthetic-106d22b51a@example.invalid', 54);

-- STAGING-ONLY synthetic actors for historical created_by foreign keys. No login or grants.
INSERT INTO auth.users(id,email,encrypted_password,banned_until,raw_app_meta_data,raw_user_meta_data) VALUES
 ('00000000-0000-0000-0000-000000000001','synthetic-system@example.invalid','', '2099-01-01','{}','{"full_name":"Synthetic system actor"}'),
 ('062c3cfb-53a5-4482-814a-cbef2b028760','synthetic-seed-actor@example.invalid','', '2099-01-01','{}','{"full_name":"Synthetic seed actor"}')
ON CONFLICT(id) DO UPDATE SET email=excluded.email,encrypted_password='',banned_until=excluded.banned_until,raw_user_meta_data=excluded.raw_user_meta_data;
