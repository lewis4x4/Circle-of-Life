-- COL-793: migration 281 (the phase 1 roster seed) ran twice on production and left 20 people with
-- two active staff rows. Migration 509 adds the guard; this probe fails on the old schema because
-- the second copy of a roster row is accepted there.
BEGIN;
DO $probe$
DECLARE
  v_seed public.staff%ROWTYPE;
  v_refused boolean;
BEGIN
  SELECT * INTO v_seed FROM public.staff
  WHERE first_name = 'Todd' AND last_name = 'Denmark' AND deleted_at IS NULL
    AND facility_id = '00000000-0000-0000-0002-000000000001';
  IF v_seed.id IS NULL THEN
    RAISE EXCEPTION 'Replay seed row from migration 281 (Todd Denmark, Oakridge) is required';
  END IF;

  -- Re-running the 281 insert for the same person is refused.
  v_refused := false;
  BEGIN
    INSERT INTO public.staff (facility_id, organization_id, first_name, last_name, phone, staff_role, employment_status, hire_date)
    VALUES (v_seed.facility_id, v_seed.organization_id, v_seed.first_name, v_seed.last_name, v_seed.phone,
            v_seed.staff_role, 'active', v_seed.hire_date);
  EXCEPTION WHEN unique_violation THEN
    v_refused := true;
  END;
  IF NOT v_refused THEN
    RAISE EXCEPTION 'A second active staff row for the same facility, name and hire date was accepted';
  END IF;

  -- Case and surrounding spaces do not make it a different person.
  v_refused := false;
  BEGIN
    INSERT INTO public.staff (facility_id, organization_id, first_name, last_name, staff_role, hire_date)
    VALUES (v_seed.facility_id, v_seed.organization_id, ' TODD ', 'denmark', v_seed.staff_role, v_seed.hire_date);
  EXCEPTION WHEN unique_violation THEN
    v_refused := true;
  END;
  IF NOT v_refused THEN
    RAISE EXCEPTION 'A case or whitespace variant of an active staff row was accepted';
  END IF;

  -- Retired rows and a genuinely different hire date (a rehire) stay allowed.
  INSERT INTO public.staff (facility_id, organization_id, first_name, last_name, staff_role, hire_date, deleted_at)
  VALUES (v_seed.facility_id, v_seed.organization_id, v_seed.first_name, v_seed.last_name, v_seed.staff_role,
          v_seed.hire_date, now());
  INSERT INTO public.staff (facility_id, organization_id, first_name, last_name, staff_role, hire_date)
  VALUES (v_seed.facility_id, v_seed.organization_id, v_seed.first_name, v_seed.last_name, v_seed.staff_role,
          v_seed.hire_date + 1);

  -- Restoring a retired copy while the original is active is refused too.
  v_refused := false;
  BEGIN
    UPDATE public.staff SET deleted_at = NULL
    WHERE first_name = v_seed.first_name AND last_name = v_seed.last_name
      AND facility_id = v_seed.facility_id AND hire_date = v_seed.hire_date AND deleted_at IS NOT NULL;
  EXCEPTION WHEN unique_violation THEN
    v_refused := true;
  END;
  IF NOT v_refused THEN
    RAISE EXCEPTION 'Restoring a retired duplicate beside the active row was accepted';
  END IF;
END
$probe$;
ROLLBACK;
