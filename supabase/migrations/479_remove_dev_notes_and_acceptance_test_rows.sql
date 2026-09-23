-- Migration 479: remove developer notes and acceptance test rows from production data (COL-688)
--
-- Brian, 2026-09-23: remove the test and seed records and the developer notes from
-- production data; soft-delete or blank, reversible and audited, no hard deletes.
--
-- Every statement matches the exact value it replaces, so a row someone has since
-- edited is left alone and a re-run changes nothing. All six tables carry the audit
-- trigger, so the prior values are in audit_log. Nothing is hard-deleted.
--
-- Rows touched on production (read 2026-09-23):
--   quality_measures    70000000-0000-0000-0000-000000000117 "Acceptance Falls Rate" -> soft-deleted, inactive
--   benchmark_cohorts   70000000-0000-0000-0000-000000000138 "Acceptance Cohort"     -> soft-deleted
--   rate_schedules      7 rows with seed / migration / ticket notes                 -> blanked or rewritten
--   insurance_policies / insurance_renewals / certificates_of_insurance:
--                       "[seed:COL-497]" and "Tracked as a COL-497 finding." removed from notes
--                       (seeded by scripts/insurance/seed-col497-insurance.mjs, which no
--                       longer writes them)

BEGIN;

-- Test rows -----------------------------------------------------------------

UPDATE public.quality_measures
SET deleted_at = now(), is_active = false, updated_at = now()
WHERE measure_key = 'acceptance_falls_rate'
  AND name = 'Acceptance Falls Rate'
  AND deleted_at IS NULL;

UPDATE public.benchmark_cohorts
SET deleted_at = now(), updated_at = now()
WHERE name = 'Acceptance Cohort'
  AND description = 'Acceptance seed benchmark cohort'
  AND deleted_at IS NULL;

-- Rate schedule notes ----------------------------------------------------------
-- Matched on the exact developer text, because production and staging carry the
-- same notes under different row ids. `notes` is one of the columns the published /
-- superseded guard lets change. The deferred overlap guard re-checks every touched
-- schedule; a row that already overlaps another (true on Haven HFO Staging's 2025
-- demo schedules, not on production) would abort the whole file, so each row is
-- checked on its own and a refused row is left as it was and reported.

DO $$
DECLARE
  v_row record;
  v_new text;
  v_changed int := 0;
BEGIN
  FOR v_row IN
    SELECT id, name, notes FROM public.rate_schedules
    WHERE notes IN (
      'COL v2 posted-rate seed. Values are cents; UI should label semi_private as Companion.',
      E'COL v2 posted-rate seed. Values are cents; UI should label semi_private as Companion.\nClosed by migration 306: superseded by Homewood posted rates effective 2026-05-01.',
      'Closed by migration 306: superseded by Homewood posted rates effective 2026-05-01.',
      E'Homewood posted May 2026 room rates from onboarding intake: private $5,550; companion $4,000.\nCorrected by migration 306: Homewood companion posted rate set to $4,400 effective 2026-05-01.',
      'Homewood posted May 2026 room rates: private $5,550; companion $4,400. Created by migration 306.',
      'Semi-private (companion) increased to $4,440 per Brian Lewis, 2026-09-23 (COL-666). Private unchanged at $5,550. Effective 2026-10-01.'
    )
    ORDER BY id
  LOOP
    v_new := CASE
      WHEN v_row.notes = 'COL v2 posted-rate seed. Values are cents; UI should label semi_private as Companion.' THEN NULL
      WHEN v_row.notes LIKE '%Closed by migration 306: superseded by Homewood posted rates effective 2026-05-01.'
        THEN 'Superseded by the Homewood posted rates effective 2026-05-01.'
      WHEN v_row.notes LIKE 'Homewood posted May 2026 room rates from onboarding intake:%'
        THEN 'Homewood posted May 2026 room rates from onboarding intake: private $5,550; companion $4,000. Companion rate corrected to $4,400 effective 2026-05-01.'
      WHEN v_row.notes LIKE 'Homewood posted May 2026 room rates: private $5,550; companion $4,400.%'
        THEN 'Homewood posted May 2026 room rates: private $5,550; companion $4,400.'
      ELSE 'Companion increased to $4,440 per Brian Lewis, 2026-09-23. Private unchanged at $5,550. Effective 2026-10-01.'
    END;
    BEGIN
      UPDATE public.rate_schedules SET notes = v_new, updated_at = now() WHERE id = v_row.id;
      SET CONSTRAINTS tr_rate_schedules_overlap_guard IMMEDIATE;
      SET CONSTRAINTS tr_rate_schedules_overlap_guard DEFERRED;
      v_changed := v_changed + 1;
    EXCEPTION WHEN exclusion_violation THEN
      SET CONSTRAINTS tr_rate_schedules_overlap_guard DEFERRED;
      RAISE NOTICE 'rate_schedules %: notes left as they were; the schedule already overlaps another (%).', v_row.id, SQLERRM;
    END;
  END LOOP;
  RAISE NOTICE 'rate_schedules: % note(s) rewritten', v_changed;
END;
$$;

-- Insurance seed markers --------------------------------------------------------

UPDATE public.insurance_policies
SET notes = replace(replace(notes, ' Tracked as a COL-497 finding.', ''), ' [seed:COL-497]', ''), updated_at = now()
WHERE organization_id = '00000000-0000-0000-0000-000000000001'
  AND deleted_at IS NULL
  AND (notes LIKE '% [seed:COL-497]%' OR notes LIKE '% Tracked as a COL-497 finding.%');

UPDATE public.insurance_renewals
SET notes = replace(notes, ' [seed:COL-497]', ''), updated_at = now()
WHERE organization_id = '00000000-0000-0000-0000-000000000001'
  AND deleted_at IS NULL
  AND notes LIKE '% [seed:COL-497]%';

UPDATE public.certificates_of_insurance
SET notes = replace(replace(notes, ' Tracked as a COL-497 finding.', ''), ' [seed:COL-497]', ''), updated_at = now()
WHERE organization_id = '00000000-0000-0000-0000-000000000001'
  AND deleted_at IS NULL
  AND (notes LIKE '% [seed:COL-497]%' OR notes LIKE '% Tracked as a COL-497 finding.%');

COMMIT;
