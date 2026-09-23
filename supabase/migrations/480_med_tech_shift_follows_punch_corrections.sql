-- COL-681 (follow-up to COL-668): the Med-Tech cockpit shift follows kiosk punch
-- corrections, not only live punches.
--
-- Migration 476 opens and closes the cockpit shift from time_records and the
-- time_punches ledger. A manager repairs the ledger with time_punch_corrections
-- (append only), and those did not reach the cockpit: an added 'out' left the
-- shift open, a voided 'in' left a shift for someone who was never on the clock,
-- and a changed clock-in time left the old time on the shift.
--
-- Now, from an AFTER INSERT trigger on time_punch_corrections:
--   * add_punch 'in'  opens the shift (same rules and window as a live 'in'),
--                     unless a later 'out' already exists for that person;
--   * add_punch 'out' closes the shift it belongs to (same close rule);
--   * void_punch of the punch (or added punch) that opened an open shift closes
--     it with a tape note: they were not on the clock;
--   * change_time of that opening punch moves the shift's clocked_in_at.
-- Voiding or retiming an 'out' does not reopen a closed shift; the tape keeps
-- the record. Like the live triggers, a correction is never refused because the
-- cockpit could not follow it.
BEGIN;

ALTER TABLE public.med_tech_shifts DROP CONSTRAINT IF EXISTS med_tech_shifts_opened_from_check;
ALTER TABLE public.med_tech_shifts ADD CONSTRAINT med_tech_shifts_opened_from_check
  CHECK (opened_from IN ('time_records', 'time_punches', 'time_punch_corrections'));

CREATE OR REPLACE FUNCTION haven.med_tech_shift_follow_punch_correction()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_shift public.med_tech_shifts;
  v_opener_source text;
  v_opener_id uuid;
BEGIN
  BEGIN
    IF NEW.correction_type = 'add_punch' AND NEW.punch_type = 'in' THEN
      IF NOT EXISTS (SELECT 1 FROM public.time_punches p
                     WHERE p.staff_id = NEW.staff_id AND p.facility_id = NEW.facility_id
                       AND p.punch_type = 'out' AND p.punched_at > NEW.corrected_punched_at)
         AND NOT EXISTS (SELECT 1 FROM public.time_punch_corrections c
                         WHERE c.staff_id = NEW.staff_id AND c.facility_id = NEW.facility_id AND c.id <> NEW.id
                           AND c.correction_type = 'add_punch' AND c.punch_type = 'out'
                           AND c.corrected_punched_at > NEW.corrected_punched_at) THEN
        -- The manager's correction is already authorized by its own policy; no actor check.
        PERFORM haven.med_tech_shift_open_from_clock(NEW.staff_id, NEW.facility_id, NEW.corrected_punched_at,
                                                     NULL, 'time_punch_corrections', NEW.id, NULL);
      END IF;
    ELSIF NEW.correction_type = 'add_punch' AND NEW.punch_type = 'out' THEN
      PERFORM haven.med_tech_shift_close_from_clock(NEW.staff_id, NEW.facility_id, NEW.corrected_punched_at,
                                                    'time_punch_corrections', NEW.id);
    ELSIF NEW.correction_type IN ('void_punch', 'change_time') THEN
      v_opener_source := CASE WHEN NEW.target_punch_id IS NOT NULL THEN 'time_punches' ELSE 'time_punch_corrections' END;
      v_opener_id := coalesce(NEW.target_punch_id, NEW.target_correction_id);
      SELECT * INTO v_shift FROM public.med_tech_shifts s
      WHERE s.opened_from = v_opener_source AND s.opened_from_id = v_opener_id
        AND s.status = 'active' AND s.deleted_at IS NULL
      FOR UPDATE;
      IF v_shift.id IS NOT NULL THEN
        IF NEW.correction_type = 'void_punch' THEN
          UPDATE public.med_tech_shifts SET status = 'completed', clocked_out_at = NEW.corrected_at, updated_by = NEW.corrected_by
          WHERE id = v_shift.id;
          INSERT INTO public.shift_tape_events (organization_id, facility_id, shift_id, event_type, event_ref_table, event_ref_id, occurred_at, summary)
          VALUES (v_shift.organization_id, v_shift.facility_id, v_shift.id, 'clock_in_voided', 'time_punch_corrections', NEW.id, NEW.corrected_at,
                  'The clock-in that opened this shift was voided; shift closed.');
        ELSE
          UPDATE public.med_tech_shifts SET clocked_in_at = NEW.corrected_punched_at, updated_by = NEW.corrected_by
          WHERE id = v_shift.id;
          INSERT INTO public.shift_tape_events (organization_id, facility_id, shift_id, event_type, event_ref_table, event_ref_id, occurred_at, summary)
          VALUES (v_shift.organization_id, v_shift.facility_id, v_shift.id, 'clock_in_corrected', 'time_punch_corrections', NEW.id, NEW.corrected_at,
                  'Clock-in time corrected by a manager.');
        END IF;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'COL-681: med-tech cockpit shift did not follow punch correction %: % (%)', NEW.id, SQLERRM, SQLSTATE;
  END;
  RETURN NULL;
END $$;
COMMENT ON FUNCTION haven.med_tech_shift_follow_punch_correction() IS
  'COL-681. AFTER INSERT trigger on time_punch_corrections: an added in/out opens/closes the med-tech cockpit shift, voiding the opening punch closes it, retiming the opening punch moves clocked_in_at. COL-37 ruling: definer required (writes the cockpit tables for the corrected staff member, which the correcting manager cannot write directly); trigger functions are authorized at CREATE TRIGGER time.';
REVOKE ALL ON FUNCTION haven.med_tech_shift_follow_punch_correction() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER tr_time_punch_corrections_med_tech_shift
  AFTER INSERT ON public.time_punch_corrections
  FOR EACH ROW EXECUTE FUNCTION haven.med_tech_shift_follow_punch_correction();

NOTIFY pgrst, 'reload schema';

COMMIT;
