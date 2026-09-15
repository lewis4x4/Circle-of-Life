-- COL-367: a bed's status has to follow who is actually in it.
--
-- Discharging a resident cleared residents.bed_id but left beds.status at
-- 'occupied', so the bed stayed spoken for with nobody in it. Homewood had
-- eight of them: 36 licensed, 33 "occupied", 25 residents. The admissions page
-- counts bed records and read "3 open beds"; the resident roster computes
-- licensed minus census and read "11". Eleven was right, and admissions was
-- under-reporting sellable capacity by eight beds on the screen where somebody
-- decides whether to accept a resident.
--
-- Nothing in the database kept the two in step -- residents carries audit,
-- timestamp, status-history and search triggers, and none of them touch beds --
-- so every write path had to remember, and the UI path did not. This puts the
-- rule in one place, where the UI, the API, HL7 intake and any import all get
-- it.
BEGIN;

-- Who holds a bed: someone living here, including a resident who is temporarily
-- out. hospital_hold and loa keep their bed because they are coming back;
-- discharged and deceased release it. inquiry and pending_admission never hold
-- one -- a reserved bed is 'hold', which this function deliberately leaves alone.
CREATE OR REPLACE FUNCTION haven.resident_status_holds_bed(p_status public.resident_status)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $function$
  SELECT p_status IN ('active','hospital_hold','loa')
$function$;
REVOKE ALL ON FUNCTION haven.resident_status_holds_bed(public.resident_status) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION haven.sync_bed_occupancy()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE b uuid;
BEGIN
  -- Both sides of a move: the bed being left and the bed being taken.
  FOREACH b IN ARRAY ARRAY[
    CASE WHEN TG_OP <> 'INSERT' THEN OLD.bed_id END,
    CASE WHEN TG_OP <> 'DELETE' THEN NEW.bed_id END
  ] LOOP
    CONTINUE WHEN b IS NULL;
    IF EXISTS (
      SELECT 1 FROM public.residents r
      WHERE r.bed_id = b AND r.deleted_at IS NULL
        AND haven.resident_status_holds_bed(r.status)
    ) THEN
      -- Taking a bed only moves it out of the two states that mean "free to
      -- assign". maintenance and offline are deliberate operational decisions
      -- and are never overridden by an assignment.
      UPDATE public.beds SET status = 'occupied'
      WHERE id = b AND deleted_at IS NULL AND status IN ('available','hold');
    ELSE
      -- Releasing only ever undoes 'occupied'. A bed someone deliberately put
      -- on hold, in maintenance, or offline stays where they put it.
      UPDATE public.beds SET status = 'available'
      WHERE id = b AND deleted_at IS NULL AND status = 'occupied';
    END IF;
  END LOOP;
  RETURN NULL;
END $function$;
REVOKE ALL ON FUNCTION haven.sync_bed_occupancy() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tr_residents_sync_bed_occupancy ON public.residents;
CREATE TRIGGER tr_residents_sync_bed_occupancy
AFTER INSERT OR DELETE OR UPDATE OF bed_id, status, deleted_at ON public.residents
FOR EACH ROW EXECUTE FUNCTION haven.sync_bed_occupancy();

COMMENT ON FUNCTION haven.sync_bed_occupancy() IS
'Keeps beds.status in step with who actually holds the bed. Releases a bed only from occupied, and claims one only from available or hold, so maintenance, offline and deliberate holds survive. COL-367.';

-- Repair the beds already stranded. Same predicate as the trigger, so this
-- cannot disagree with the rule that keeps them right from now on. Deliberate
-- hold/maintenance/offline beds are untouched.
UPDATE public.beds b
SET status = 'available'
WHERE b.deleted_at IS NULL
  AND b.status = 'occupied'
  AND NOT EXISTS (
    SELECT 1 FROM public.residents r
    WHERE r.bed_id = b.id AND r.deleted_at IS NULL
      AND haven.resident_status_holds_bed(r.status)
  );

NOTIFY pgrst, 'reload schema';

COMMIT;
