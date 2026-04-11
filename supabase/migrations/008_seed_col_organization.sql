-- COL org / entities / facilities (spec 00-foundation) — fixed UUIDs for local + remote parity

INSERT INTO organizations (id, name, dba_name, primary_contact_name, primary_contact_email, primary_contact_phone, address_line_1, city, state, zip)
  VALUES ('00000000-0000-0000-0000-000000000001', 'Circle of Life Assisted Living Communities', 'Circle of Life', 'Milton Smith', 'jessicamurphy@circleoflifecommunities.com', '386-339-1634', '426 SW Commerce Dr Ste 130D', 'Lake City', 'FL', '32025');

INSERT INTO entities (id, organization_id, name, dba_name, entity_type, fein, years_ownership, years_management, address_line_1, city, state, zip)
  VALUES ('00000000-0000-0000-0001-000000000001', '00000000-0000-0000-0000-000000000001', 'Pine House, Inc.', 'Oakridge ALF', 'Inc.', '59-3588292', 12, 12, '297 SW County Road 300', 'Mayo', 'FL', '32066'),
('00000000-0000-0000-0001-000000000002', '00000000-0000-0000-0000-000000000001', 'Smith & Sorensen LLC', 'Rising Oaks ALF', 'LLC', '47-5082758', 11, 11, '201 NW Ranchera Street', 'Live Oak', 'FL', '32064'),
('00000000-0000-0000-0001-000000000003', '00000000-0000-0000-0000-000000000001', 'Sorensen, Smith & Bay, LLC', 'Homewood Lodge, ALF', 'LLC', '47-1198264', 13, 13, '430 SE Mills Street', 'Mayo', 'FL', '32066'),
('00000000-0000-0000-0001-000000000004', '00000000-0000-0000-0000-000000000001', 'The Plantation on Summers, LLC', 'Plantation ALF', 'LLC', '26-2147479', 9, 9, '1478 W Summers Lane', 'Lake City', 'FL', '32025'),
('00000000-0000-0000-0001-000000000005', '00000000-0000-0000-0000-000000000001', 'Grande Cypress ALF LLC', NULL, 'LLC', '86-3065500', 5, 5, '970 SW Pinemount Rd', 'Lake City', 'FL', '32024');

INSERT INTO facilities (id, entity_id, organization_id, name, license_type, address_line_1, city, state, zip, county, phone, email, total_licensed_beds)
  VALUES ('00000000-0000-0000-0002-000000000001', '00000000-0000-0000-0001-000000000001', '00000000-0000-0000-0000-000000000001', 'Oakridge ALF', 'alf_intermediate', '297 SW County Road 300', 'Mayo', 'FL', '32066', 'Lafayette', '386-339-1634', 'jessicamurphy@circleoflifecommunities.com', 52),
('00000000-0000-0000-0002-000000000002', '00000000-0000-0000-0001-000000000002', '00000000-0000-0000-0000-000000000001', 'Rising Oaks ALF', 'alf_intermediate', '201 NW Ranchera Street', 'Live Oak', 'FL', '32064', 'Suwannee', '386-339-1634', 'jessicamurphy@circleoflifecommunities.com', 52),
('00000000-0000-0000-0002-000000000003', '00000000-0000-0000-0001-000000000003', '00000000-0000-0000-0000-000000000001', 'Homewood Lodge ALF', 'alf_intermediate', '430 SE Mills Street', 'Mayo', 'FL', '32066', 'Lafayette', '386-339-1634', 'jessicamurphy@circleoflifecommunities.com', 36),
('00000000-0000-0000-0002-000000000004', '00000000-0000-0000-0001-000000000004', '00000000-0000-0000-0000-000000000001', 'Plantation ALF', 'alf_intermediate', '1478 W Summers Lane', 'Lake City', 'FL', '32025', 'Columbia', '386-339-1634', 'jessicamurphy@circleoflifecommunities.com', 64),
('00000000-0000-0000-0002-000000000005', '00000000-0000-0000-0001-000000000005', '00000000-0000-0000-0000-000000000001', 'Grande Cypress ALF', 'alf_intermediate', '970 SW Pinemount Rd', 'Lake City', 'FL', '32024', 'Columbia', '386-339-1634', 'jessicamurphy@circleoflifecommunities.com', 54);
