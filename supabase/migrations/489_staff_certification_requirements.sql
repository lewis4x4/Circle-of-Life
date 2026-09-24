-- COL-709 / COL-710: certification requirements per job role, and the
-- "expiring soon" window, become configuration.
--
-- Before this, every staff member was treated as needing a certification: the
-- roster flagged owners and recruiters as "no certification on file" beside
-- med-techs, and the 60-day "expiring soon" window was a literal in three
-- places of application code.
--
-- Brian's ruling (2026-09-23, COL-709): "Certification tracking is set per job
-- role. Admins choose which job roles need which certifications (runtime-
-- configurable, effective-dated). Owners and executives aren't flagged unless
-- their role is configured." No requirement is seeded: which roles need which
-- certifications is the admins' decision, and until they record one the pages
-- say "Certification requirements not set up" instead of flagging anyone.
--
-- The expiring-soon window is carried over as the organization default at the
-- value the code already used (60 days), so nothing changes until an admin
-- changes it.
--
-- Both tables follow med_tech_shift_rules (476): append only and effective-
-- dated, organization default (facility_id NULL) with a per-facility override;
-- a change is a new row with a reason, never an edit, so history reads as of
-- its own time. Dropping a requirement is a newer row with required = false.
-- The job role is staff.staff_role (a job title), not the login app_role.

BEGIN;

-- ---------------------------------------------------------------------------
-- Which job roles need which certification types
-- ---------------------------------------------------------------------------
CREATE TABLE public.staff_certification_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NULL REFERENCES public.facilities(id),
  staff_role public.staff_role NOT NULL,
  certification_type text NOT NULL CHECK (certification_type ~ '^[a-z0-9_]{1,64}$'),
  required boolean NOT NULL,
  effective_from timestamptz NOT NULL,
  change_reason text NOT NULL CHECK (char_length(btrim(change_reason)) BETWEEN 1 AND 500),
  created_by uuid NULL REFERENCES public.user_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_staff_certification_requirements_scope_effective
  ON public.staff_certification_requirements (organization_id, facility_id, staff_role, certification_type, effective_from)
  NULLS NOT DISTINCT;

COMMENT ON TABLE public.staff_certification_requirements IS
  'COL-709. Which job roles (staff.staff_role) need which certification types (staff_certifications.certification_type). facility_id NULL is the organization default; a facility row overrides it for that role and type. Append only: a change is a new row with a later effective_from; required = false drops a requirement.';

REVOKE ALL ON public.staff_certification_requirements FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.staff_certification_requirements TO authenticated;
GRANT ALL ON public.staff_certification_requirements TO service_role;
ALTER TABLE public.staff_certification_requirements ENABLE ROW LEVEL SECURITY;

CREATE POLICY staff_certification_requirements_read ON public.staff_certification_requirements
  FOR SELECT TO authenticated
  USING (
    organization_id = (SELECT haven.organization_id())
    AND (facility_id IS NULL OR facility_id IN (SELECT haven.accessible_facility_ids()))
  );

-- Owners and org admins set the organization default; they and facility admins
-- set a facility override for a building they can reach. No backdating.
CREATE POLICY staff_certification_requirements_insert ON public.staff_certification_requirements
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = (SELECT haven.organization_id())
    AND created_by = auth.uid()
    AND effective_from >= now() - interval '5 minutes'
    AND (
      (facility_id IS NULL AND (SELECT haven.app_role()) IN ('owner', 'org_admin'))
      OR (
        facility_id IN (SELECT haven.accessible_facility_ids())
        AND (SELECT haven.app_role()) IN ('owner', 'org_admin', 'facility_admin')
      )
    )
  );

CREATE TRIGGER tr_staff_certification_requirements_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.staff_certification_requirements
  FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();

-- ---------------------------------------------------------------------------
-- The "expiring soon" window
-- ---------------------------------------------------------------------------
CREATE TABLE public.staff_certification_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NULL REFERENCES public.facilities(id),
  -- Guardrail: at least a week of warning, at most a year.
  expiring_soon_days integer NOT NULL CHECK (expiring_soon_days BETWEEN 7 AND 365),
  effective_from timestamptz NOT NULL,
  change_reason text NOT NULL CHECK (char_length(btrim(change_reason)) BETWEEN 1 AND 500),
  created_by uuid NULL REFERENCES public.user_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_staff_certification_settings_scope_effective
  ON public.staff_certification_settings (organization_id, facility_id, effective_from) NULLS NOT DISTINCT;

COMMENT ON TABLE public.staff_certification_settings IS
  'COL-710. How many days before expiry a certification reads "expiring soon" (7-365). facility_id NULL is the organization default; a facility row overrides it. Append only, effective-dated.';

REVOKE ALL ON public.staff_certification_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.staff_certification_settings TO authenticated;
GRANT ALL ON public.staff_certification_settings TO service_role;
ALTER TABLE public.staff_certification_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY staff_certification_settings_read ON public.staff_certification_settings
  FOR SELECT TO authenticated
  USING (
    organization_id = (SELECT haven.organization_id())
    AND (facility_id IS NULL OR facility_id IN (SELECT haven.accessible_facility_ids()))
  );

CREATE POLICY staff_certification_settings_insert ON public.staff_certification_settings
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = (SELECT haven.organization_id())
    AND created_by = auth.uid()
    AND effective_from >= now() - interval '5 minutes'
    AND (
      (facility_id IS NULL AND (SELECT haven.app_role()) IN ('owner', 'org_admin'))
      OR (
        facility_id IN (SELECT haven.accessible_facility_ids())
        AND (SELECT haven.app_role()) IN ('owner', 'org_admin', 'facility_admin')
      )
    )
  );

CREATE TRIGGER tr_staff_certification_settings_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.staff_certification_settings
  FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();

-- The window the code used until now, as the organization default.
INSERT INTO public.staff_certification_settings (organization_id, facility_id, expiring_soon_days, effective_from, change_reason)
SELECT o.id, NULL, 60, now(),
       'Carried over from application code (COL-710): certifications read "expiring soon" 60 days before they expire.'
FROM public.organizations o
WHERE o.deleted_at IS NULL;

COMMIT;

NOTIFY pgrst, 'reload schema';
