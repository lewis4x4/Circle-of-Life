-- Resident / representative acknowledgement of a signed care plan.
--
-- care_plans carries one signature: the staff approver. The paper ISP has
-- resident and representative lines, and a printed Haven plan without them is
-- weaker than the binder page it replaces. Acknowledgements are recorded
-- against the active version, append-only: a correction is a new row.

CREATE TABLE public.care_plan_acknowledgements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES public.organizations (id),
  facility_id uuid NOT NULL REFERENCES public.facilities (id),
  care_plan_id uuid NOT NULL REFERENCES public.care_plans (id),
  resident_id uuid NOT NULL REFERENCES public.residents (id),
  signer_role text NOT NULL CHECK (signer_role IN ('resident', 'responsible_party', 'poa', 'guardian')),
  signer_name text NOT NULL CHECK (length(btrim(signer_name)) >= 2),
  relationship_to_resident text,
  method text NOT NULL CHECK (method IN ('in_person_signature', 'paper_on_file', 'verbal_review', 'declined')),
  signature_data text,
  acknowledged_at timestamptz NOT NULL DEFAULT now (),
  recorded_by uuid NOT NULL REFERENCES auth.users (id),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now (),
  deleted_at timestamptz,
  CONSTRAINT care_plan_acknowledgements_signature_when_in_person CHECK (
    method <> 'in_person_signature' OR signature_data IS NOT NULL
  )
);

CREATE INDEX idx_care_plan_acknowledgements_plan ON public.care_plan_acknowledgements (care_plan_id)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_care_plan_acknowledgements_resident ON public.care_plan_acknowledgements (resident_id)
  WHERE deleted_at IS NULL;

ALTER TABLE public.care_plan_acknowledgements ENABLE ROW LEVEL SECURITY;

CREATE POLICY staff_see_care_plan_acknowledgements ON public.care_plan_acknowledgements
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids ())
    AND haven.app_role () NOT IN ('family', 'broker', 'dietary', 'maintenance_role')
  );

-- Acknowledge what was signed, not a draft: the plan must be active and match.
CREATE POLICY clinical_staff_record_care_plan_acknowledgements ON public.care_plan_acknowledgements
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND facility_id IN (SELECT haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse')
    AND recorded_by = auth.uid ()
    AND EXISTS (
      SELECT 1 FROM public.care_plans cp
      WHERE cp.id = care_plan_id
        AND cp.organization_id = organization_id
        AND cp.facility_id = facility_id
        AND cp.resident_id = resident_id
        AND cp.status = 'active'
        AND cp.deleted_at IS NULL
    )
  );
-- No UPDATE or DELETE policy: rows are evidence. Corrections append.

CREATE TRIGGER tr_care_plan_acknowledgements_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.care_plan_acknowledgements
  FOR EACH ROW EXECUTE PROCEDURE public.haven_capture_audit_log ();

NOTIFY pgrst, 'reload schema';
