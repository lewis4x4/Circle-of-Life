-- KB-NEXT-07: kb_seed_targets table + global default rows.
--
-- The KB is only valuable if it can actually answer the questions ALF staff
-- ask. Today we have no coverage signal: a doc is uploaded, it might or might
-- not match what nurses search. kb_seed_targets is a planning table that
-- enumerates the topics the KB *should* cover for an assisted-living
-- operator, with sample questions and the expected compliance scope. It's
-- the bedrock for:
--   1. KB-NEXT-09 owner-curated seed (mark targets as 'covered' as docs land).
--   2. KB-NEXT-11 coverage dashboard ("12 of 18 critical topics have at
--      least one published doc").
--   3. The gaps loop (questions that miss can be diffed against this list to
--      decide whether to ask the owner to write a doc).
--
-- Schema deliberately small: priority + status + sample_questions is enough
-- to drive coverage UX without prematurely modelling owner workflow.

CREATE TABLE IF NOT EXISTS public.kb_seed_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- NULL workspace_id = global default seed shipped with the platform.
  topic_slug text NOT NULL,
  topic_label text NOT NULL,
  description text,
  sample_questions text[] NOT NULL DEFAULT '{}',
  expected_compliance_category text,
  expected_audience text,
  priority smallint NOT NULL DEFAULT 50
    CHECK (priority BETWEEN 0 AND 100),
  status text NOT NULL DEFAULT 'uncovered'
    CHECK (status IN ('uncovered','covered','wip','retired')),
  covered_document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_kb_seed_targets_workspace_slug
  ON public.kb_seed_targets (COALESCE(workspace_id, '00000000-0000-0000-0000-000000000000'::uuid), topic_slug);

CREATE INDEX IF NOT EXISTS idx_kb_seed_targets_status
  ON public.kb_seed_targets (workspace_id, status)
  WHERE status IN ('uncovered','wip');

-- ---------------------------------------------------------------------------
-- RLS: global rows readable by everyone; org rows scoped to that org. Only
-- owner/org_admin can mutate org rows. Global rows are platform-managed and
-- not writable from the app (insertion via migration only).
-- ---------------------------------------------------------------------------

ALTER TABLE public.kb_seed_targets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS kb_seed_targets_select ON public.kb_seed_targets;
CREATE POLICY kb_seed_targets_select ON public.kb_seed_targets
  FOR SELECT
  TO authenticated
  USING (
    workspace_id IS NULL
    OR workspace_id = haven.organization_id()
  );

DROP POLICY IF EXISTS kb_seed_targets_insert ON public.kb_seed_targets;
CREATE POLICY kb_seed_targets_insert ON public.kb_seed_targets
  FOR INSERT
  TO authenticated
  WITH CHECK (
    workspace_id = haven.organization_id()
    AND haven.app_role() IN ('owner','org_admin')
  );

DROP POLICY IF EXISTS kb_seed_targets_update ON public.kb_seed_targets;
CREATE POLICY kb_seed_targets_update ON public.kb_seed_targets
  FOR UPDATE
  TO authenticated
  USING (
    workspace_id = haven.organization_id()
    AND haven.app_role() IN ('owner','org_admin')
  )
  WITH CHECK (
    workspace_id = haven.organization_id()
    AND haven.app_role() IN ('owner','org_admin')
  );

DROP POLICY IF EXISTS kb_seed_targets_delete ON public.kb_seed_targets;
CREATE POLICY kb_seed_targets_delete ON public.kb_seed_targets
  FOR DELETE
  TO authenticated
  USING (
    workspace_id = haven.organization_id()
    AND haven.app_role() IN ('owner','org_admin')
  );

-- updated_at trigger
CREATE OR REPLACE FUNCTION public._kb_seed_targets_touch()
  RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_kb_seed_targets_touch ON public.kb_seed_targets;
CREATE TRIGGER trg_kb_seed_targets_touch
  BEFORE UPDATE ON public.kb_seed_targets
  FOR EACH ROW
  EXECUTE FUNCTION public._kb_seed_targets_touch();

-- ---------------------------------------------------------------------------
-- Coverage rollup view: counts uncovered vs covered per workspace, blending
-- global defaults with org-specific targets. Workspace_id NULL rows are
-- treated as "applies to every workspace" — the view UNIONs them in for each
-- org via the haven helper. We use a function-style "by_workspace" view so
-- the coverage page can call .from('vw_kb_seed_target_coverage').
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.vw_kb_seed_target_coverage
WITH (security_invoker = true)
AS
SELECT
  COALESCE(t.workspace_id, haven.organization_id()) AS workspace_id,
  COUNT(*) FILTER (WHERE t.status = 'covered') AS covered_count,
  COUNT(*) FILTER (WHERE t.status = 'wip')       AS wip_count,
  COUNT(*) FILTER (WHERE t.status = 'uncovered') AS uncovered_count,
  COUNT(*) FILTER (WHERE t.status = 'retired')   AS retired_count,
  COUNT(*) AS total_targets,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE t.status = 'covered') /
      NULLIF(COUNT(*) FILTER (WHERE t.status IN ('covered','wip','uncovered')), 0),
    1
  ) AS covered_pct
FROM public.kb_seed_targets t
WHERE
  t.workspace_id IS NULL OR t.workspace_id = haven.organization_id()
GROUP BY COALESCE(t.workspace_id, haven.organization_id());

GRANT SELECT ON public.vw_kb_seed_target_coverage TO authenticated;

COMMENT ON VIEW public.vw_kb_seed_target_coverage IS
  'KB-NEXT-07: coverage rollup for kb_seed_targets, RLS-safe via security_invoker.';

-- ---------------------------------------------------------------------------
-- Global default seed targets (workspace_id NULL).
--
-- Sourced from FL AHCA / FAC 59A-36 critical operations: medication mgmt,
-- 1823, fall prevention, incident reporting, infection control, dietary,
-- discharge, resident rights, emergency prep, abuse reporting. These are the
-- "must-be-answerable" questions for any ALF; org-specific topics belong in
-- per-org rows added by the owner.
-- ---------------------------------------------------------------------------

INSERT INTO public.kb_seed_targets (
  workspace_id, topic_slug, topic_label, description, sample_questions,
  expected_compliance_category, expected_audience, priority
) VALUES
  (NULL, 'medication_admin_pass',
   'Medication pass procedure',
   'Five-rights med pass workflow, eMAR documentation, missed dose protocol.',
   ARRAY[
     'What are the five rights for medication administration?',
     'What do I do if I miss a scheduled dose?',
     'Where do I document a refused medication?'
   ],
   'medication_admin_policy', 'company_wide', 95),

  (NULL, 'form_1823',
   'Florida Form 1823 (AHCA Physician''s Report)',
   'Form 1823 must be on file before admission and re-issued annually.',
   ARRAY[
     'When is the 1823 due for a new resident?',
     'Who can sign the 1823?',
     'How long do we keep 1823 on file after discharge?'
   ],
   'ahca_regulation', 'facility_scoped', 95),

  (NULL, 'fall_prevention_protocol',
   'Fall prevention and post-fall protocol',
   'Post-fall assessment, neuro checks, incident report timeline, family notification.',
   ARRAY[
     'What''s the post-fall checklist?',
     'Do I need to do neuro checks after a witnessed fall without injury?',
     'When do I have to notify the family after a fall?'
   ],
   'sop', 'company_wide', 90),

  (NULL, 'incident_reporting_levels',
   'Incident severity levels and reporting timelines',
   'AHCA 24/15-day reporting thresholds, level 1-4 definitions.',
   ARRAY[
     'What is a Level 1 vs Level 2 incident?',
     'How fast does an adverse incident need to be reported to AHCA?',
     'Who do I notify for a Level 3 incident?'
   ],
   'ahca_regulation', 'facility_scoped', 90),

  (NULL, 'infection_control_outbreak',
   'Infection control & outbreak response',
   'Hand hygiene, PPE escalation, AHCA outbreak reporting, isolation protocol.',
   ARRAY[
     'When do we move from standard to droplet precautions?',
     'What counts as an outbreak we have to report?',
     'Who is the infection preventionist on call?'
   ],
   'sop', 'company_wide', 85),

  (NULL, 'discharge_transition',
   'Discharge planning & DCF/MCO notification',
   'Discharge summary, MCO notification, DCF Form 2506, family/POA handoff.',
   ARRAY[
     'What documents go in a discharge packet?',
     'Do I need to notify DCF when a Medicaid resident discharges?',
     'How quickly do I notify the MCO after discharge?'
   ],
   'sop', 'facility_scoped', 80),

  (NULL, 'resident_rights_grievance',
   'Resident rights, grievance procedure, abuse reporting',
   'Florida 415.1034 reporting duty, grievance log, retaliation prohibition.',
   ARRAY[
     'How do I file a grievance on behalf of a resident?',
     'Who do I call to report suspected abuse?',
     'How long do we keep the grievance log?'
   ],
   'resident_rights_policy', 'company_wide', 85),

  (NULL, 'dietary_thickened_liquids',
   'Dietary orders: textures, thickened liquids, allergies',
   'IDDSI levels, swallow-precaution orders, allergy cross-checks.',
   ARRAY[
     'What does Nectar Thick vs Honey Thick mean?',
     'How do I document a refused puree meal?',
     'Where do I see active food allergies for a resident?'
   ],
   'dietary_policy', 'company_wide', 75),

  (NULL, 'emergency_prep_evacuation',
   'Emergency preparedness, evacuation, hurricane plan',
   'CEMP requirements, generator runtime, evacuation host facility list.',
   ARRAY[
     'Where is the current evacuation host facility list?',
     'How long must the generator run on its own?',
     'Who activates the CEMP plan?'
   ],
   'emergency_prep_policy', 'facility_scoped', 80),

  (NULL, 'baya_medication_training',
   'Baya medication training & competency',
   'Baya partner training cadence, competency certificate tracking, refresher windows.',
   ARRAY[
     'When does a med tech need a Baya refresher?',
     'Where do I see a staff member''s Baya competency status?',
     'What happens if Baya cert expires?'
   ],
   'training_material', 'facility_scoped', 70),

  (NULL, 'medicaid_mco_directory',
   'Medicaid MCO directory & escalation contacts',
   'Per-facility MCO list (FCC, Sunshine Health, Humana, WellCare, UHC), case-manager numbers.',
   ARRAY[
     'Who is the MCO for this resident?',
     'How do I reach Sunshine Health for a member?',
     'Which MCO covers behavioral health overrides?'
   ],
   'general', 'facility_scoped', 70),

  (NULL, 'admission_workflow_overview',
   'Admission workflow & required documents',
   'Pre-admission checklist, 1823, MCO eligibility, ID/insurance copies, room assignment.',
   ARRAY[
     'What documents do I need before move-in?',
     'When do I create the resident record vs the inquiry record?',
     'Who signs off on the admission packet?'
   ],
   'sop', 'facility_scoped', 75)
ON CONFLICT (COALESCE(workspace_id, '00000000-0000-0000-0000-000000000000'::uuid), topic_slug) DO NOTHING;
