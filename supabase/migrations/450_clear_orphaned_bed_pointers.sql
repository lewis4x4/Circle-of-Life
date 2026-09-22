-- COL-508. Migration 444 made residents.bed_id canonical and refuses a claim on
-- any bed whose legacy beds.current_resident_id disagrees, rather than erasing a
-- pointer that might belong to someone. That is the right default, and it left
-- three Homewood beds unusable: marked available, holding no one, and still
-- pointing at a resident who holds no bed at all.
--
-- This clears only that unambiguous shape. A bed is repaired when it is live and
-- available, reserved for nobody, has no live holder, and the resident it names
-- does not claim it. Nothing here chooses between two residents competing for a
-- bed; a bed with a real competing claim keeps its pointer and keeps needing a
-- human assignment decision. Residents are not touched at all, so the census
-- cannot move. The beds audit trigger records every row this changes.
BEGIN;

CREATE TEMP TABLE col508_candidates ON COMMIT DROP AS
SELECT b.id FROM public.beds b
WHERE b.deleted_at IS NULL
  AND b.current_resident_id IS NOT NULL
  AND b.status = 'available'
  AND b.reserved_for_admission_case_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.residents holder
    WHERE holder.bed_id = b.id AND holder.deleted_at IS NULL
      AND haven.resident_status_holds_bed(holder.status))
  AND NOT EXISTS (
    SELECT 1 FROM public.residents named
    WHERE named.id = b.current_resident_id AND named.deleted_at IS NULL
      AND named.bed_id = b.id);

CREATE TEMP TABLE col508_cleared ON COMMIT DROP AS
WITH repaired AS (
  UPDATE public.beds SET current_resident_id = NULL
  WHERE id IN (SELECT id FROM col508_candidates)
  RETURNING id
)
SELECT id FROM repaired;

DO $function$
DECLARE candidates bigint; cleared bigint; still_blocked bigint;
BEGIN
  SELECT count(*) INTO candidates FROM col508_candidates;
  SELECT count(*) INTO cleared FROM col508_cleared;
  IF candidates <> cleared THEN
    RAISE EXCEPTION 'Bed pointer repair touched % rows for % candidates', cleared, candidates;
  END IF;
  -- Re-evaluating the same shape must now find nothing. Anything left is a real
  -- conflict this migration deliberately declines to resolve.
  SELECT count(*) INTO still_blocked FROM public.beds b
  WHERE b.deleted_at IS NULL
    AND b.current_resident_id IS NOT NULL
    AND b.status = 'available'
    AND b.reserved_for_admission_case_id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.residents holder
      WHERE holder.bed_id = b.id AND holder.deleted_at IS NULL
        AND haven.resident_status_holds_bed(holder.status))
    AND NOT EXISTS (
      SELECT 1 FROM public.residents named
      WHERE named.id = b.current_resident_id AND named.deleted_at IS NULL
        AND named.bed_id = b.id);
  IF still_blocked > 0 THEN
    RAISE EXCEPTION 'Bed pointer repair left % unambiguous orphan(s)', still_blocked;
  END IF;
END $function$;

COMMIT;
