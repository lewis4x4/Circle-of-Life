-- Keep incident number allocation ahead of any seeded or manually inserted incidents.
-- The helper table can drift below the actual max incident number for a facility/year,
-- which causes duplicate incident_number values on the next caregiver/admin submission.

CREATE OR REPLACE FUNCTION public.allocate_incident_number (p_facility_id uuid)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, haven
  AS $func$
DECLARE
  v_year integer;
  v_prefix text;
  v_next integer;
  v_org uuid;
  v_clean text;
  v_existing_max integer;
BEGIN
  IF auth.uid () IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT (haven.app_role () = ANY (ARRAY['owner'::app_role, 'org_admin'::app_role, 'facility_admin'::app_role, 'nurse'::app_role, 'caregiver'::app_role])) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT
    f.organization_id INTO v_org
  FROM
    facilities f
  WHERE
    f.id = p_facility_id
    AND f.deleted_at IS NULL;

  IF v_org IS NULL OR v_org <> haven.organization_id () THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_facility_id NOT IN (
    SELECT
      haven.accessible_facility_ids ()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  v_year := (EXTRACT(YEAR FROM timezone('America/New_York', now())))::integer;

  SELECT
    COALESCE(NULLIF(trim(f.settings ->> 'incident_report_prefix'), ''), '') INTO v_prefix
  FROM
    facilities f
  WHERE
    f.id = p_facility_id;

  IF v_prefix IS NULL OR length(v_prefix) = 0 THEN
    SELECT
      regexp_replace(f.name, '[^a-zA-Z]', '', 'g') INTO v_clean
    FROM
      facilities f
    WHERE
      f.id = p_facility_id;
    v_prefix := upper(left(coalesce(v_clean, ''), 3));
  END IF;

  IF v_prefix IS NULL OR length(v_prefix) < 3 THEN
    v_prefix := 'HVN';
  END IF;

  IF length(v_prefix) > 12 THEN
    v_prefix := left(v_prefix, 12);
  END IF;

  SELECT
    COALESCE(MAX(COALESCE(NULLIF(substring(i.incident_number FROM '([0-9]+)$'), ''), '0')::integer), 0) INTO v_existing_max
  FROM
    incidents i
  WHERE
    i.facility_id = p_facility_id
    AND i.deleted_at IS NULL
    AND i.incident_number LIKE format('%s-%s-%%', v_prefix, v_year);

  INSERT INTO incident_sequences (facility_id, year, last_number)
    VALUES (p_facility_id, v_year, v_existing_max)
  ON CONFLICT (facility_id, year)
    DO NOTHING;

  UPDATE
    incident_sequences
  SET
    last_number = GREATEST(last_number + 1, v_existing_max + 1)
  WHERE
    facility_id = p_facility_id
    AND year = v_year
  RETURNING
    last_number INTO v_next;

  RETURN format('%s-%s-%s', v_prefix, v_year, lpad(v_next::text, 4, '0'));
END
$func$;
