-- Track E — E1: COL seed / live data corrections (Oakridge address, Homewood entity)
-- Aligns with HAVEN build verification: Country→County road name; Homewood LLLC→LLC.

UPDATE entities
SET
  address_line_1 = '297 SW County Road 300'
WHERE
  id = '00000000-0000-0000-0001-000000000001';

UPDATE facilities
SET
  address_line_1 = '297 SW County Road 300'
WHERE
  id = '00000000-0000-0000-0002-000000000001';

UPDATE entities
SET
  name = 'Sorensen, Smith & Bay, LLC',
  entity_type = 'LLC'
WHERE
  id = '00000000-0000-0000-0001-000000000003';
