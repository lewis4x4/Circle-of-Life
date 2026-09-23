-- COL-668: the Med-Tech cockpit shift opens on clock-in and closes on clock-out.
--
-- Before this, nothing in Haven wrote med_tech_shifts except the demo seed (173),
-- so every real med-tech saw "Cockpit is waiting on a shift" forever, whether or
-- not they had clocked in.
--
-- Brian's ruling (2026-09-23): "WHEN THEY CLOCK IN AND CLOCK OUT." Per the
-- standing rule the trigger is configuration, not code: med_tech_shift_rules is
-- effective-dated (a change is a new row, never an edit) with an organization
-- default and a per-facility override. The ruling is recorded as the organization
-- default row below; a facility can switch either trigger off with a newer row.
--
-- The writer runs from triggers on both clocks:
--   * time_records (the floor app's /caregiver/clock): an open punch opens the
--     shift, setting clock_out (or voiding the open punch) closes it;
--   * time_punches (the COL-352 kiosk ledger): 'in' opens, 'out' closes.
-- Facility comes from the punch. The shift window comes from the facility's own
-- facility_shift_definitions (the start nearest the clock-in). Unit and residents
-- come from the staff member's shift assignment for that window when there is
-- one (assigned residents, else the unit's residents), else every active
-- resident of the facility. Med passes are the active orders' scheduled doses in
-- the window that are not already resolved and not already held by another open
-- cockpit shift. A punch is never refused because a cockpit shift could not be
-- opened or closed: the writer raises a WARNING and the punch stands.

BEGIN;

-- ---------------------------------------------------------------------------
-- Rules: effective-dated, organization default + facility override
-- ---------------------------------------------------------------------------
CREATE TABLE public.med_tech_shift_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NULL REFERENCES public.facilities(id),
  open_trigger text NOT NULL CHECK (open_trigger IN ('clock_in', 'none')),
  close_trigger text NOT NULL CHECK (close_trigger IN ('clock_out', 'none')),
  effective_from timestamptz NOT NULL,
  change_reason text NOT NULL CHECK (char_length(btrim(change_reason)) BETWEEN 1 AND 500),
  created_by uuid NULL REFERENCES public.user_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_med_tech_shift_rules_scope_effective
  ON public.med_tech_shift_rules (organization_id, facility_id, effective_from) NULLS NOT DISTINCT;

COMMENT ON TABLE public.med_tech_shift_rules IS
  'COL-668. What opens and closes a Med-Tech cockpit shift. facility_id NULL is the organization default; a facility row overrides it. Append only: a change is a new row with a later effective_from, so history resolves as of its own time.';
COMMENT ON COLUMN public.med_tech_shift_rules.open_trigger IS
  'clock_in: a med-tech clock-in (time_records or the kiosk ledger) opens their cockpit shift. none: the clock does not open cockpit shifts.';
COMMENT ON COLUMN public.med_tech_shift_rules.close_trigger IS
  'clock_out: the clock-out closes the open cockpit shift. none: the clock does not close it.';

REVOKE ALL ON public.med_tech_shift_rules FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.med_tech_shift_rules TO authenticated;
GRANT ALL ON public.med_tech_shift_rules TO service_role;
ALTER TABLE public.med_tech_shift_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY med_tech_shift_rules_read ON public.med_tech_shift_rules
  FOR SELECT TO authenticated
  USING (
    organization_id = haven.organization_id()
    AND (facility_id IS NULL OR facility_id IN (SELECT haven.accessible_facility_ids()))
  );

-- Owners and org admins set the organization default; they and facility admins
-- set a facility override for a building they can reach. No backdating: a rule
-- takes effect now or later, never rewrites what already happened.
CREATE POLICY med_tech_shift_rules_insert ON public.med_tech_shift_rules
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = haven.organization_id()
    AND created_by = auth.uid()
    AND effective_from >= now() - interval '5 minutes'
    AND (
      (facility_id IS NULL AND haven.app_role() IN ('owner', 'org_admin'))
      OR (
        facility_id IN (SELECT haven.accessible_facility_ids())
        AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin')
      )
    )
  );

CREATE TRIGGER tr_med_tech_shift_rules_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.med_tech_shift_rules
  FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();

-- Brian's ruling as the organization default, effective now.
INSERT INTO public.med_tech_shift_rules (organization_id, facility_id, open_trigger, close_trigger, effective_from, change_reason)
SELECT o.id, NULL, 'clock_in', 'clock_out', now(),
       'Brian Lewis ruling 2026-09-23 (COL-668): a med-tech cockpit shift opens when they clock in and closes when they clock out.'
FROM public.organizations o
WHERE o.deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Shift provenance: where the shift came from and what unit it covers
-- ---------------------------------------------------------------------------
ALTER TABLE public.med_tech_shifts
  ADD COLUMN unit_id uuid NULL REFERENCES public.units(id),
  ADD COLUMN shift_assignment_id uuid NULL REFERENCES public.shift_assignments(id),
  ADD COLUMN opened_from text NULL CHECK (opened_from IN ('time_records', 'time_punches')),
  ADD COLUMN opened_from_id uuid NULL,
  ADD COLUMN rule_id uuid NULL REFERENCES public.med_tech_shift_rules(id);
-- A facility without shift definitions still gets a shift on clock-in; its end is
-- then unknown rather than invented.
ALTER TABLE public.med_tech_shifts ALTER COLUMN shift_end DROP NOT NULL;

-- One open cockpit shift per person, so a double punch cannot open two.
CREATE UNIQUE INDEX idx_med_tech_shifts_one_active_per_user
  ON public.med_tech_shifts (user_id) WHERE status = 'active' AND deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Rule resolution
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION haven.med_tech_shift_rule_at(p_organization_id uuid, p_facility_id uuid, p_at timestamptz)
RETURNS public.med_tech_shift_rules
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT r.*
  FROM public.med_tech_shift_rules r
  WHERE r.organization_id = p_organization_id
    AND (r.facility_id = p_facility_id OR r.facility_id IS NULL)
    AND r.effective_from <= p_at
  ORDER BY (r.facility_id IS NULL), r.effective_from DESC
  LIMIT 1
$$;
COMMENT ON FUNCTION haven.med_tech_shift_rule_at(uuid, uuid, timestamptz) IS
  'COL-668. The med-tech shift rule in force at a facility at an instant: the latest facility override, else the latest organization default. COL-37 ruling: definer required so the clock triggers resolve the rule for any punching role; execute is revoked from every request role.';
REVOKE ALL ON FUNCTION haven.med_tech_shift_rule_at(uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Open
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION haven.med_tech_shift_open_from_clock(
  p_staff_id uuid,
  p_facility_id uuid,
  p_at timestamptz,
  p_shift_assignment_id uuid,
  p_source text,
  p_source_id uuid
) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user uuid;
  v_org uuid;
  v_tz text;
  v_rule public.med_tech_shift_rules;
  v_def record;
  v_start timestamptz;
  v_end timestamptz;
  v_assignment public.shift_assignments;
  v_shift uuid;
BEGIN
  SELECT s.user_id, s.organization_id INTO v_user, v_org
  FROM public.staff s
  JOIN public.user_profiles p ON p.id = s.user_id
  WHERE s.id = p_staff_id AND s.deleted_at IS NULL
    AND p.app_role = 'med_tech' AND p.is_active AND p.deleted_at IS NULL;
  IF v_user IS NULL THEN RETURN NULL; END IF;

  SELECT f.timezone INTO v_tz FROM public.facilities f
  WHERE f.id = p_facility_id AND f.organization_id = v_org AND f.deleted_at IS NULL;
  IF v_tz IS NULL THEN RETURN NULL; END IF;

  v_rule := haven.med_tech_shift_rule_at(v_org, p_facility_id, p_at);
  IF v_rule.id IS NULL OR v_rule.open_trigger <> 'clock_in' THEN RETURN NULL; END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('med_tech_shift|' || v_user::text, 0));
  IF EXISTS (SELECT 1 FROM public.med_tech_shifts WHERE user_id = v_user AND status = 'active' AND deleted_at IS NULL) THEN
    RETURN NULL;
  END IF;

  -- The facility's shift whose start is nearest the clock-in (early or late).
  SELECT d.roster_shift_type,
         ((day.d + d.starts_at_local) AT TIME ZONE v_tz) AS starts_at,
         ((day.d + CASE WHEN d.ends_at_local <= d.starts_at_local THEN 1 ELSE 0 END + d.ends_at_local) AT TIME ZONE v_tz) AS ends_at
    INTO v_def
  FROM public.facility_shift_definitions d
  CROSS JOIN LATERAL (
    SELECT ((p_at AT TIME ZONE v_tz)::date + o) AS d FROM pg_catalog.generate_series(-1, 1) o
  ) day
  WHERE d.facility_id = p_facility_id AND d.active AND d.deleted_at IS NULL
  ORDER BY pg_catalog.abs(EXTRACT(epoch FROM (p_at - ((day.d + d.starts_at_local) AT TIME ZONE v_tz)))),
           d.sort_order
  LIMIT 1;
  v_start := coalesce(v_def.starts_at, p_at);
  v_end := v_def.ends_at;

  IF p_shift_assignment_id IS NOT NULL THEN
    SELECT * INTO v_assignment FROM public.shift_assignments a
    WHERE a.id = p_shift_assignment_id AND a.staff_id = p_staff_id AND a.deleted_at IS NULL;
  ELSIF v_def.roster_shift_type IS NOT NULL THEN
    SELECT * INTO v_assignment FROM public.shift_assignments a
    WHERE a.staff_id = p_staff_id AND a.facility_id = p_facility_id AND a.deleted_at IS NULL
      AND a.shift_date = (v_start AT TIME ZONE v_tz)::date
      AND a.shift_type = v_def.roster_shift_type
      AND a.status NOT IN ('called_out', 'no_show', 'swap_requested')
    ORDER BY a.created_at DESC LIMIT 1;
  END IF;

  INSERT INTO public.med_tech_shifts (
    organization_id, facility_id, user_id, shift_start, shift_end, clocked_in_at, status,
    unit_id, shift_assignment_id, opened_from, opened_from_id, rule_id, created_by
  ) VALUES (
    v_org, p_facility_id, v_user, v_start, v_end, p_at, 'active',
    v_assignment.unit_id, v_assignment.id, p_source, p_source_id, v_rule.id, v_user
  ) RETURNING id INTO v_shift;

  -- Residents: the assignment's residents, else its unit's, else the building's.
  INSERT INTO public.med_tech_shift_residents (shift_id, resident_id, organization_id, facility_id, priority)
  SELECT v_shift, r.id, v_org, p_facility_id,
         row_number() OVER (ORDER BY r.last_name, r.first_name, r.id)::integer
  FROM public.residents r
  WHERE r.facility_id = p_facility_id AND r.organization_id = v_org
    AND r.status = 'active' AND r.deleted_at IS NULL
    AND CASE
      WHEN coalesce(pg_catalog.cardinality(v_assignment.assigned_resident_ids), 0) > 0
        THEN r.id = ANY (v_assignment.assigned_resident_ids)
      WHEN v_assignment.unit_id IS NOT NULL
        THEN EXISTS (SELECT 1 FROM public.beds b JOIN public.rooms rm ON rm.id = b.room_id
                     WHERE b.id = r.bed_id AND rm.unit_id = v_assignment.unit_id)
      ELSE true
    END;

  -- Scheduled doses in the window, by the same schedule rules guard_emar_review
  -- enforces, minus doses already resolved or held by another open shift.
  IF v_end IS NOT NULL THEN
    INSERT INTO public.med_passes (
      organization_id, facility_id, shift_id, resident_id, resident_medication_id,
      scheduled_time, status, witness_required, controlled_substance, administered_by, created_by
    )
    SELECT v_org, p_facility_id, v_shift, m.resident_id, m.id,
           dose.at, 'pending', m.witness_required, m.controlled_schedule <> 'non_controlled', v_user, v_user
    FROM public.med_tech_shift_residents sr
    JOIN public.resident_medications m
      ON m.resident_id = sr.resident_id AND m.facility_id = p_facility_id
     AND m.status = 'active' AND m.deleted_at IS NULL AND m.frequency <> 'prn'
    CROSS JOIN LATERAL (
      SELECT ((day.d + t) AT TIME ZONE v_tz) AS at, day.d
      FROM pg_catalog.generate_series((v_start AT TIME ZONE v_tz)::date::timestamp, (v_end AT TIME ZONE v_tz)::date::timestamp, interval '1 day') g(g)
      CROSS JOIN LATERAL (SELECT g.g::date AS d) day
      CROSS JOIN LATERAL pg_catalog.unnest(m.scheduled_times) t
    ) dose
    WHERE sr.shift_id = v_shift
      AND dose.at >= v_start AND dose.at < v_end
      AND dose.d >= m.start_date AND (m.end_date IS NULL OR dose.d <= m.end_date)
      AND NOT (m.frequency = 'weekly' AND (dose.d - m.start_date) % 7 <> 0)
      AND NOT (m.frequency = 'biweekly' AND (dose.d - m.start_date) % 14 <> 0)
      AND NOT (m.frequency = 'monthly' AND EXTRACT(day FROM dose.d) <> EXTRACT(day FROM m.start_date))
      AND NOT EXISTS (SELECT 1 FROM public.emar_records e
                      WHERE e.resident_medication_id = m.id AND e.scheduled_time = dose.at
                        AND NOT e.is_prn AND e.deleted_at IS NULL AND e.status <> 'scheduled')
      AND NOT EXISTS (SELECT 1 FROM public.med_passes mp
                      JOIN public.med_tech_shifts s ON s.id = mp.shift_id
                      WHERE mp.resident_medication_id = m.id AND mp.scheduled_time = dose.at
                        AND mp.deleted_at IS NULL AND mp.status IN ('pending', 'overdue')
                        AND s.status = 'active' AND s.deleted_at IS NULL AND s.id <> v_shift);
  END IF;

  INSERT INTO public.shift_tape_events (organization_id, facility_id, shift_id, event_type, event_ref_table, event_ref_id, occurred_at, summary)
  VALUES (v_org, p_facility_id, v_shift, 'clock_in', p_source, p_source_id, p_at,
          CASE WHEN v_end IS NULL
               THEN 'Clocked in. No shift times are set for this facility, so no med passes were scheduled.'
               ELSE 'Clocked in; shift opened from the time clock.' END);

  RETURN v_shift;
END $$;
COMMENT ON FUNCTION haven.med_tech_shift_open_from_clock(uuid, uuid, timestamptz, uuid, text, uuid) IS
  'COL-668. Opens a med-tech''s cockpit shift from a clock-in when the facility rule says clock_in: shift window from facility_shift_definitions, residents from the shift assignment (or unit, or building), med passes from active scheduled orders. Idempotent per person. COL-37 ruling: definer required; it writes the cockpit tables for the punching med-tech from a clock trigger, which the punching role cannot write directly. Execute is revoked from every request role.';
REVOKE ALL ON FUNCTION haven.med_tech_shift_open_from_clock(uuid, uuid, timestamptz, uuid, text, uuid) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Close
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION haven.med_tech_shift_close_from_clock(
  p_staff_id uuid,
  p_facility_id uuid,
  p_at timestamptz,
  p_source text,
  p_source_id uuid
) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user uuid;
  v_org uuid;
  v_rule public.med_tech_shift_rules;
  v_shift uuid;
BEGIN
  SELECT s.user_id, s.organization_id INTO v_user, v_org
  FROM public.staff s WHERE s.id = p_staff_id AND s.deleted_at IS NULL;
  IF v_user IS NULL THEN RETURN NULL; END IF;

  v_rule := haven.med_tech_shift_rule_at(v_org, p_facility_id, p_at);
  IF v_rule.id IS NULL OR v_rule.close_trigger <> 'clock_out' THEN RETURN NULL; END IF;

  UPDATE public.med_tech_shifts
     SET status = 'completed', clocked_out_at = p_at, updated_by = v_user
   WHERE user_id = v_user AND facility_id = p_facility_id
     AND status = 'active' AND deleted_at IS NULL
  RETURNING id INTO v_shift;
  IF v_shift IS NULL THEN RETURN NULL; END IF;

  INSERT INTO public.shift_tape_events (organization_id, facility_id, shift_id, event_type, event_ref_table, event_ref_id, occurred_at, summary)
  VALUES (v_org, p_facility_id, v_shift, 'clock_out', p_source, p_source_id, p_at, 'Clocked out; shift closed from the time clock.');
  RETURN v_shift;
END $$;
COMMENT ON FUNCTION haven.med_tech_shift_close_from_clock(uuid, uuid, timestamptz, text, uuid) IS
  'COL-668. Closes a med-tech''s open cockpit shift at a facility from a clock-out when the facility rule says clock_out. Unresolved passes stay on the closed shift as the record of unfinished work; the next open shift re-schedules them. COL-37 ruling: definer required for the same reason as the opener; execute is revoked from every request role.';
REVOKE ALL ON FUNCTION haven.med_tech_shift_close_from_clock(uuid, uuid, timestamptz, text, uuid) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Clock triggers. A punch is never refused because the cockpit could not follow.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION haven.med_tech_shift_follow_time_record()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  BEGIN
    IF TG_OP = 'INSERT' THEN
      IF NEW.clock_out IS NULL AND NEW.deleted_at IS NULL THEN
        PERFORM haven.med_tech_shift_open_from_clock(NEW.staff_id, NEW.facility_id, NEW.clock_in, NEW.shift_assignment_id, 'time_records', NEW.id);
      END IF;
    ELSIF OLD.clock_out IS NULL AND OLD.deleted_at IS NULL THEN
      IF NEW.clock_out IS NOT NULL THEN
        PERFORM haven.med_tech_shift_close_from_clock(NEW.staff_id, NEW.facility_id, NEW.clock_out, 'time_records', NEW.id);
      ELSIF NEW.deleted_at IS NOT NULL THEN
        -- A voided open punch means they are not on the clock.
        PERFORM haven.med_tech_shift_close_from_clock(NEW.staff_id, NEW.facility_id, NEW.deleted_at, 'time_records', NEW.id);
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'COL-668: med-tech cockpit shift did not follow time record %: % (%)', NEW.id, SQLERRM, SQLSTATE;
  END;
  RETURN NULL;
END $$;
COMMENT ON FUNCTION haven.med_tech_shift_follow_time_record() IS
  'COL-668. AFTER trigger on time_records: open punch opens the med-tech cockpit shift; clock-out or voiding the open punch closes it. COL-37 ruling: definer required (see the opener); trigger functions are authorized at CREATE TRIGGER time.';
REVOKE ALL ON FUNCTION haven.med_tech_shift_follow_time_record() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER tr_time_records_med_tech_shift
  AFTER INSERT OR UPDATE OF clock_out, deleted_at ON public.time_records
  FOR EACH ROW EXECUTE FUNCTION haven.med_tech_shift_follow_time_record();

CREATE OR REPLACE FUNCTION haven.med_tech_shift_follow_time_punch()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  BEGIN
    IF NEW.punch_type = 'in' THEN
      -- An offline 'in' synced after its own 'out' is history, not a live shift.
      IF NOT EXISTS (SELECT 1 FROM public.time_punches p
                     WHERE p.staff_id = NEW.staff_id AND p.facility_id = NEW.facility_id
                       AND p.punch_type = 'out' AND p.punched_at > NEW.punched_at) THEN
        PERFORM haven.med_tech_shift_open_from_clock(NEW.staff_id, NEW.facility_id, NEW.punched_at, NULL, 'time_punches', NEW.id);
      END IF;
    ELSIF NEW.punch_type = 'out' THEN
      PERFORM haven.med_tech_shift_close_from_clock(NEW.staff_id, NEW.facility_id, NEW.punched_at, 'time_punches', NEW.id);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'COL-668: med-tech cockpit shift did not follow time punch %: % (%)', NEW.id, SQLERRM, SQLSTATE;
  END;
  RETURN NULL;
END $$;
COMMENT ON FUNCTION haven.med_tech_shift_follow_time_punch() IS
  'COL-668. AFTER INSERT trigger on the kiosk punch ledger: in opens, out closes the med-tech cockpit shift. COL-37 ruling: definer required (see the opener); trigger functions are authorized at CREATE TRIGGER time.';
REVOKE ALL ON FUNCTION haven.med_tech_shift_follow_time_punch() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER tr_time_punches_med_tech_shift
  AFTER INSERT ON public.time_punches
  FOR EACH ROW EXECUTE FUNCTION haven.med_tech_shift_follow_time_punch();

NOTIFY pgrst, 'reload schema';

COMMIT;
