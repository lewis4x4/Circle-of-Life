-- COL display/DBA alignment. No change to tax IDs, ownership, licenses, or tenant IDs.
-- Sunbiz entity L13000146046 confirms SORENSEN, SMITH & BAY LLC (not LLLC).
-- See docs/reviews/2026-09-05-col-name-alignment.md for source and deployment scope.
BEGIN;

CREATE TEMP TABLE haven_col_name_alignment_expected (
  ordinal integer PRIMARY KEY,
  facility_before text NOT NULL,
  facility_after text NOT NULL,
  entity_before text NOT NULL,
  entity_after text NOT NULL,
  dba_before text,
  dba_after text NOT NULL
) ON COMMIT DROP;

INSERT INTO haven_col_name_alignment_expected VALUES
  (1, 'Oakridge ALF', 'Oakridge ALF', 'Pine House, Inc.', 'Pine House, Inc.', 'Oakridge ALF', 'Oakridge ALF'),
  (2, 'Rising Oaks ALF', 'Rising Oaks ALF', 'Smith & Sorensen LLC', 'Smith & Sorensen LLC', 'Rising Oaks ALF', 'Rising Oaks ALF'),
  (3, 'Homewood Lodge ALF', 'Homewood Lodge, ALF', 'Sorensen, Smith & Bay, LLC', 'Sorensen, Smith & Bay LLC', 'Homewood Lodge, ALF', 'Homewood Lodge, ALF'),
  (4, 'Plantation ALF', 'The Plantation on Summers', 'The Plantation on Summers, LLC', 'The Plantation on Summers, LLC', 'Plantation ALF', 'The Plantation on Summers'),
  (5, 'Grande Cypress ALF', 'Grande Cypress ALF', 'Grande Cypress ALF LLC', 'Grande Cypress ALF LLC', NULL, 'Grande Cypress ALF');

DO $alignment$
DECLARE
  matched integer;
BEGIN
  -- Lock exactly the canonical rows before checking their names and relationships.
  PERFORM f.id FROM public.facilities f
    JOIN haven_col_name_alignment_expected x ON
      f.id = ('00000000-0000-0000-0002-' || lpad(x.ordinal::text, 12, '0'))::uuid
    FOR UPDATE OF f;
  PERFORM e.id FROM public.entities e
    JOIN haven_col_name_alignment_expected x ON
      e.id = ('00000000-0000-0000-0001-' || lpad(x.ordinal::text, 12, '0'))::uuid
    FOR UPDATE OF e;

  SELECT count(*) INTO matched
  FROM haven_col_name_alignment_expected x
  JOIN public.facilities f ON
    f.id = ('00000000-0000-0000-0002-' || lpad(x.ordinal::text, 12, '0'))::uuid
  JOIN public.entities e ON
    e.id = ('00000000-0000-0000-0001-' || lpad(x.ordinal::text, 12, '0'))::uuid
  WHERE f.entity_id = e.id
    AND f.organization_id = '00000000-0000-0000-0000-000000000001'::uuid
    AND e.organization_id = f.organization_id
    AND f.deleted_at IS NULL AND e.deleted_at IS NULL
    AND f.name IN (x.facility_before, x.facility_after)
    AND e.name IN (x.entity_before, x.entity_after)
    AND (e.dba_name IS NOT DISTINCT FROM x.dba_before
      OR e.dba_name IS NOT DISTINCT FROM x.dba_after);

  IF matched <> 5 THEN
    RAISE EXCEPTION 'COL name alignment preflight failed: expected five canonical facility/entity mappings; no names changed';
  END IF;
END
$alignment$;

UPDATE public.facilities f
SET name = x.facility_after
FROM haven_col_name_alignment_expected x
WHERE f.id = ('00000000-0000-0000-0002-' || lpad(x.ordinal::text, 12, '0'))::uuid
  AND f.organization_id = '00000000-0000-0000-0000-000000000001'::uuid
  AND f.deleted_at IS NULL
  AND f.name IS DISTINCT FROM x.facility_after;

UPDATE public.entities e
SET name = x.entity_after, dba_name = x.dba_after
FROM haven_col_name_alignment_expected x
WHERE e.id = ('00000000-0000-0000-0001-' || lpad(x.ordinal::text, 12, '0'))::uuid
  AND e.organization_id = '00000000-0000-0000-0000-000000000001'::uuid
  AND e.deleted_at IS NULL
  AND (e.name, e.dba_name) IS DISTINCT FROM (x.entity_after, x.dba_after);

-- Existing foundation audit and updated_at triggers capture the five changed rows.
COMMIT;
