-- COL-465: record what Haven judged about a facility insurance document.
--
-- Berkadia's HUD 232 servicing requires the mortgagee wording on every property
-- evidence and endorsement to name Berkadia Commercial Mortgage LLC and the
-- Assistant Secretary for Housing together, with successors-and-assigns
-- language. Generic wording satisfies a carrier's forms department and fails the
-- lender, and today that only gets caught by reading each document by hand.
--
-- One row per judgment, never updated. The row records the probabilities the
-- model returned, not just the route, so a threshold can be re-cut later
-- against judgments already made; `questions_version` marks which wording and
-- thresholds produced it, because a row scored under one version cannot be
-- compared with a row scored under another.
--
-- Scope: facility documents only. Nothing resident-identifying is sent to the
-- model that fills this table, and nothing here may be extended to resident
-- records until the subprocessor question behind it is settled.
BEGIN;

CREATE TABLE public.compliance_doc_triage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES public.organizations (id),
  facility_id uuid NOT NULL REFERENCES public.facilities (id),
  facility_document_id uuid NOT NULL REFERENCES public.facility_documents (id) ON DELETE CASCADE,
  -- The vault's own category, copied at judgment time: the document may be
  -- recategorised later, and this row describes what was judged then.
  document_category text NOT NULL,
  -- What the model read the document as, and how concentrated that answer was.
  doc_type text NOT NULL,
  doc_type_confidence numeric(4, 3) NOT NULL,
  -- Which facility the document names. The vault row is authoritative for
  -- filing; this is the cross-check on whether the right file was uploaded.
  -- NULL match means the check could not run: unresolved, or a facility the
  -- question set cannot name.
  facility_named text NOT NULL,
  facility_confidence numeric(4, 3) NOT NULL,
  facility_matches boolean,
  -- The three HUD 232 mortgagee parties, kept apart so a failure says which one
  -- is missing rather than that the wording is wrong.
  names_berkadia numeric(4, 3) NOT NULL,
  names_hud_secretary numeric(4, 3) NOT NULL,
  isaoa_atima_present numeric(4, 3) NOT NULL,
  epi_period text NOT NULL,
  is_draft numeric(4, 3) NOT NULL,
  carrier_and_policy_identified numeric(4, 3) NOT NULL,
  readiness numeric(4, 3) NOT NULL,
  -- Defects Haven is confident about; these are what an agent gets told.
  flags text[] NOT NULL DEFAULT '{}',
  -- Things Haven is not confident about; these route to a person instead.
  uncertainties text[] NOT NULL DEFAULT '{}',
  route text NOT NULL CHECK (route IN ('blocked', 'human_review', 'pending_carrier', 'send_ready')),
  questions_version text NOT NULL,
  model text,
  input_tokens integer,
  output_tokens integer,
  created_at timestamptz NOT NULL DEFAULT now ()
);

CREATE INDEX idx_compliance_doc_triage_route ON public.compliance_doc_triage (route, created_at DESC);

CREATE INDEX idx_compliance_doc_triage_facility ON public.compliance_doc_triage (facility_id, created_at DESC);

CREATE INDEX idx_compliance_doc_triage_document ON public.compliance_doc_triage (facility_document_id, created_at DESC);

ALTER TABLE public.compliance_doc_triage ENABLE ROW LEVEL SECURITY;

-- Same reach as the vault rows these judgments describe: whoever can see the
-- document can see what Haven concluded about it. Rows are written by the edge
-- function under the service role, which bypasses RLS; there is deliberately no
-- INSERT, UPDATE or DELETE policy, so a judgment cannot be edited after the fact.
CREATE POLICY compliance_doc_triage_select ON public.compliance_doc_triage
  FOR SELECT
    TO authenticated
      USING (organization_id = haven.organization_id ()
        AND facility_id IN (
          SELECT
            haven.accessible_facility_ids ()));

COMMIT;
