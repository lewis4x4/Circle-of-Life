-- COL v2 Slice 5: staff compliance, staff attestations, route seeds, and executor-compatible rule queries.
-- This migration is additive: it uses existing staff/training/compliance/notification systems instead of rebuilding them.

ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS application_received_at timestamptz,
  ADD COLUMN IF NOT EXISTS application_stage text,
  ADD COLUMN IF NOT EXISTS references_complete boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS references_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS compliance_failure_at timestamptz,
  ADD COLUMN IF NOT EXISTS compliance_failure_reason text,
  ADD COLUMN IF NOT EXISTS compliance_hold_until date;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'staff_application_stage_valid'
      AND conrelid = 'public.staff'::regclass
  ) THEN
    ALTER TABLE public.staff
      ADD CONSTRAINT staff_application_stage_valid
      CHECK (
        application_stage IS NULL OR application_stage IN (
          'application',
          'background_check',
          'references',
          'offer',
          'hired',
          'onboarding',
          'active',
          'terminated',
          'withdrawn'
        )
      );
  END IF;
END $$;

COMMENT ON COLUMN public.staff.application_stage IS 'COL applicant/onboarding stage before and after hire; does not replace employment_status.';
COMMENT ON COLUMN public.staff.compliance_failure_at IS 'Timestamp when staff member was marked out of compliance for launch/operations follow-up.';
COMMENT ON COLUMN public.staff.compliance_hold_until IS 'Optional date through which staff member should remain excluded from compliant coverage counts.';

CREATE INDEX IF NOT EXISTS idx_staff_application_stage
  ON public.staff(facility_id, application_stage)
  WHERE deleted_at IS NULL AND application_stage IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_staff_compliance_failure
  ON public.staff(facility_id, compliance_failure_at DESC)
  WHERE deleted_at IS NULL AND compliance_failure_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.staff_facility_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  role_at_facility staff_role,
  is_primary boolean NOT NULL DEFAULT false,
  start_date date NOT NULL DEFAULT CURRENT_DATE,
  end_date date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.user_profiles(id),
  updated_by uuid REFERENCES public.user_profiles(id),
  deleted_at timestamptz,
  CHECK (end_date IS NULL OR end_date >= start_date)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_facility_assignments_active_unique
  ON public.staff_facility_assignments(staff_id, facility_id)
  WHERE deleted_at IS NULL AND end_date IS NULL;

CREATE INDEX IF NOT EXISTS idx_staff_facility_assignments_facility
  ON public.staff_facility_assignments(facility_id, role_at_facility)
  WHERE deleted_at IS NULL AND end_date IS NULL;

CREATE TABLE IF NOT EXISTS public.staff_attestations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  attestation_type text NOT NULL CHECK (attestation_type ~ '^[a-z0-9_]+$'),
  attestation_text text NOT NULL,
  effective_date date NOT NULL DEFAULT CURRENT_DATE,
  expires_at date,
  signed_at timestamptz NOT NULL DEFAULT now(),
  signed_by_user_id uuid REFERENCES public.user_profiles(id) DEFAULT auth.uid(),
  signer_name text,
  signer_ip inet,
  user_agent text,
  evidence_storage_path text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.user_profiles(id),
  updated_by uuid REFERENCES public.user_profiles(id),
  deleted_at timestamptz,
  CHECK (expires_at IS NULL OR expires_at >= effective_date)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_attestations_active_unique
  ON public.staff_attestations(staff_id, attestation_type, effective_date)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_staff_attestations_facility_type
  ON public.staff_attestations(facility_id, attestation_type, signed_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_staff_attestations_expiry
  ON public.staff_attestations(expires_at)
  WHERE deleted_at IS NULL AND expires_at IS NOT NULL;

ALTER TABLE public.staff_facility_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_attestations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS staff_facility_assignments_select ON public.staff_facility_assignments;
CREATE POLICY staff_facility_assignments_select ON public.staff_facility_assignments
  FOR SELECT TO authenticated
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND (
      facility_id IN (SELECT haven.accessible_facility_ids())
      OR EXISTS (
        SELECT 1
        FROM public.staff s
        WHERE s.id = staff_facility_assignments.staff_id
          AND s.user_id = auth.uid()
          AND s.deleted_at IS NULL
      )
    )
  );

DROP POLICY IF EXISTS staff_facility_assignments_manage ON public.staff_facility_assignments;
CREATE POLICY staff_facility_assignments_manage ON public.staff_facility_assignments
  FOR ALL TO authenticated
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager')
  )
  WITH CHECK (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager')
  );

DROP POLICY IF EXISTS staff_attestations_select ON public.staff_attestations;
CREATE POLICY staff_attestations_select ON public.staff_attestations
  FOR SELECT TO authenticated
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND (
      facility_id IN (SELECT haven.accessible_facility_ids())
      OR signed_by_user_id = auth.uid()
      OR EXISTS (
        SELECT 1
        FROM public.staff s
        WHERE s.id = staff_attestations.staff_id
          AND s.user_id = auth.uid()
          AND s.deleted_at IS NULL
      )
    )
  );

DROP POLICY IF EXISTS staff_attestations_insert_self ON public.staff_attestations;
CREATE POLICY staff_attestations_insert_self ON public.staff_attestations
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = haven.organization_id()
    AND signed_by_user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.staff s
      WHERE s.id = staff_attestations.staff_id
        AND s.organization_id = staff_attestations.organization_id
        AND s.facility_id = staff_attestations.facility_id
        AND s.user_id = auth.uid()
        AND s.deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS staff_attestations_manage ON public.staff_attestations;
CREATE POLICY staff_attestations_manage ON public.staff_attestations
  FOR ALL TO authenticated
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager', 'nurse')
  )
  WITH CHECK (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager', 'nurse')
  );

DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['staff_facility_assignments','staff_attestations'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS tr_%s_set_updated_at ON public.%I', v_table, v_table);
    EXECUTE format('CREATE TRIGGER tr_%s_set_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE PROCEDURE public.haven_set_updated_at()', v_table, v_table);
    EXECUTE format('DROP TRIGGER IF EXISTS tr_%s_audit ON public.%I', v_table, v_table);
    EXECUTE format('CREATE TRIGGER tr_%s_audit AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE PROCEDURE public.haven_capture_audit_log()', v_table, v_table);
  END LOOP;
END $$;


-- Existing compliance_rules has an updated_at trigger that writes NEW.updated_by,
-- but the original table omitted updated_by. Add it before repairing rule rows.
ALTER TABLE public.compliance_rules
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id);

WITH col_org AS (
  SELECT '00000000-0000-0000-0000-000000000001'::uuid AS organization_id
), training_seed AS (
  SELECT * FROM (VALUES
    ('COL_RESIDENT_RIGHTS', 'COL Resident Rights', 'Resident rights training required before floor work.', 'at_hire'::training_frequency, ARRAY['cna','lpn','rn','administrator','assistant_administrator','medication_tech','resident_aide']::text[], true, true),
    ('COL_INFECTION_CONTROL', 'COL Infection Control', 'Infection control training required before floor work.', 'at_hire'::training_frequency, ARRAY['cna','lpn','rn','administrator','assistant_administrator','medication_tech','resident_aide','housekeeping','dietary_staff','dietary_aide']::text[], true, true),
    ('COL_UNIVERSAL_PRECAUTIONS', 'COL Universal Precautions', 'Universal precautions training required before floor work.', 'at_hire'::training_frequency, ARRAY['cna','lpn','rn','medication_tech','resident_aide','housekeeping','dietary_staff','dietary_aide']::text[], true, true),
    ('COL_COMMUNICABLE_DISEASE', 'COL Communicable Disease', 'Communicable disease training required within 30 days of hire.', 'annual'::training_frequency, ARRAY['cna','lpn','rn','administrator','assistant_administrator','medication_tech','resident_aide','housekeeping','dietary_staff','dietary_aide']::text[], true, true),
    ('COL_MED_TECH_ATTESTATION', 'COL Medication Technician Attestation', 'Medication technicians attest that training, scope, and escalation rules are understood.', 'annual'::training_frequency, ARRAY['medication_tech','lpn','rn']::text[], true, false)
  ) AS v(code, name, description, frequency, applies_to_roles, is_mandatory, is_fl_required)
)
INSERT INTO public.training_programs (
  organization_id,
  code,
  name,
  description,
  delivery_method,
  frequency,
  applies_to_roles,
  is_mandatory,
  is_fl_required,
  active
)
SELECT
  col_org.organization_id,
  training_seed.code,
  training_seed.name,
  training_seed.description,
  'in_person'::training_delivery_method,
  training_seed.frequency,
  training_seed.applies_to_roles,
  training_seed.is_mandatory,
  training_seed.is_fl_required,
  true
FROM col_org
CROSS JOIN training_seed
ON CONFLICT (organization_id, code) DO NOTHING;

-- Repair Slice 4 operational rule queries to match the current compliance executor.
UPDATE public.compliance_rules
SET check_query = CASE tag_number
  WHEN 'COL-MAINT-001' THEN 'SELECT COUNT(*) = 0 FROM public.facilities f WHERE f.id = (SELECT id FROM facilities LIMIT 1) AND NOT EXISTS (SELECT 1 FROM public.maintenance_task_completions mtc WHERE mtc.facility_id = f.id AND mtc.task_type = ''grease_trap'' AND mtc.completed_at > now() - interval ''3 months'' AND mtc.deleted_at IS NULL)'
  WHEN 'COL-MAINT-002' THEN 'SELECT COUNT(*) = 0 FROM public.facilities f WHERE f.id = (SELECT id FROM facilities LIMIT 1) AND NOT EXISTS (SELECT 1 FROM public.maintenance_task_completions mtc WHERE mtc.facility_id = f.id AND mtc.task_type = ''leak_check'' AND mtc.completed_at > now() - interval ''1 month'' AND mtc.deleted_at IS NULL)'
  WHEN 'COL-MAINT-003' THEN 'SELECT COUNT(*) = 0 FROM public.facilities f WHERE f.id = (SELECT id FROM facilities LIMIT 1) AND NOT EXISTS (SELECT 1 FROM public.maintenance_task_completions mtc WHERE mtc.facility_id = f.id AND mtc.task_type = ''ac_filter'' AND mtc.completed_at > now() - interval ''1 month'' AND mtc.deleted_at IS NULL)'
  WHEN 'COL-DRILL-001' THEN 'SELECT COUNT(*) = 0 FROM public.facilities f WHERE f.id = (SELECT id FROM facilities LIMIT 1) AND (SELECT COUNT(*) FROM public.drill_log dl WHERE dl.facility_id = f.id AND dl.drill_type = ''fire'' AND EXTRACT(YEAR FROM dl.drill_date) = EXTRACT(YEAR FROM CURRENT_DATE) AND dl.deleted_at IS NULL) < 6'
  WHEN 'COL-DRILL-002' THEN 'SELECT COUNT(*) = 0 FROM public.facilities f WHERE f.id = (SELECT id FROM facilities LIMIT 1) AND (SELECT COUNT(*) FROM public.drill_log dl WHERE dl.facility_id = f.id AND dl.drill_type = ''elopement'' AND EXTRACT(YEAR FROM dl.drill_date) = EXTRACT(YEAR FROM CURRENT_DATE) AND dl.deleted_at IS NULL) < 2'
  ELSE check_query
END,
updated_at = now()
WHERE organization_id = '00000000-0000-0000-0000-000000000001'
  AND tag_number IN ('COL-MAINT-001', 'COL-MAINT-002', 'COL-MAINT-003', 'COL-DRILL-001', 'COL-DRILL-002')
  AND deleted_at IS NULL;

WITH rule_seed AS (
  SELECT
    f.organization_id,
    f.id AS facility_id,
    v.tag_number,
    v.tag_title,
    v.rule_description,
    v.check_query,
    v.severity
  FROM public.facilities f
  CROSS JOIN (VALUES
    ('COL-HR-001', 'Pre-Service Resident Rights', 'Active direct-care staff must have Resident Rights training on file.', 'SELECT COUNT(*) = 0 FROM public.staff s WHERE s.facility_id = (SELECT id FROM facilities LIMIT 1) AND s.deleted_at IS NULL AND s.employment_status = ''active'' AND s.staff_role = ANY(ARRAY[''cna'',''lpn'',''rn'',''medication_tech'',''resident_aide'']::staff_role[]) AND NOT EXISTS (SELECT 1 FROM public.staff_training_completions stc JOIN public.training_programs tp ON tp.id = stc.training_program_id WHERE stc.staff_id = s.id AND stc.deleted_at IS NULL AND tp.code = ''COL_RESIDENT_RIGHTS'' AND tp.deleted_at IS NULL)', 'serious'),
    ('COL-HR-002', 'Pre-Service Infection Control', 'Active direct-care, dietary, and housekeeping staff must have Infection Control training on file.', 'SELECT COUNT(*) = 0 FROM public.staff s WHERE s.facility_id = (SELECT id FROM facilities LIMIT 1) AND s.deleted_at IS NULL AND s.employment_status = ''active'' AND s.staff_role = ANY(ARRAY[''cna'',''lpn'',''rn'',''medication_tech'',''resident_aide'',''housekeeping'',''dietary_staff'',''dietary_aide'']::staff_role[]) AND NOT EXISTS (SELECT 1 FROM public.staff_training_completions stc JOIN public.training_programs tp ON tp.id = stc.training_program_id WHERE stc.staff_id = s.id AND stc.deleted_at IS NULL AND tp.code = ''COL_INFECTION_CONTROL'' AND tp.deleted_at IS NULL)', 'serious'),
    ('COL-HR-003', 'Pre-Service Universal Precautions', 'Active direct-care, dietary, and housekeeping staff must have Universal Precautions training on file.', 'SELECT COUNT(*) = 0 FROM public.staff s WHERE s.facility_id = (SELECT id FROM facilities LIMIT 1) AND s.deleted_at IS NULL AND s.employment_status = ''active'' AND s.staff_role = ANY(ARRAY[''cna'',''lpn'',''rn'',''medication_tech'',''resident_aide'',''housekeeping'',''dietary_staff'',''dietary_aide'']::staff_role[]) AND NOT EXISTS (SELECT 1 FROM public.staff_training_completions stc JOIN public.training_programs tp ON tp.id = stc.training_program_id WHERE stc.staff_id = s.id AND stc.deleted_at IS NULL AND tp.code = ''COL_UNIVERSAL_PRECAUTIONS'' AND tp.deleted_at IS NULL)', 'serious'),
    ('COL-HR-004', '30-Day Communicable Disease', 'Active staff employed more than 30 days must have Communicable Disease training on file.', 'SELECT COUNT(*) = 0 FROM public.staff s WHERE s.facility_id = (SELECT id FROM facilities LIMIT 1) AND s.deleted_at IS NULL AND s.employment_status = ''active'' AND s.hire_date < CURRENT_DATE - 30 AND NOT EXISTS (SELECT 1 FROM public.staff_training_completions stc JOIN public.training_programs tp ON tp.id = stc.training_program_id WHERE stc.staff_id = s.id AND stc.deleted_at IS NULL AND tp.code = ''COL_COMMUNICABLE_DISEASE'' AND tp.deleted_at IS NULL)', 'serious'),
    ('COL-HR-005', '30-Day TB Test', 'Active staff employed more than 30 days must have TB test evidence on file.', 'SELECT COUNT(*) = 0 FROM public.staff s WHERE s.facility_id = (SELECT id FROM facilities LIMIT 1) AND s.deleted_at IS NULL AND s.employment_status = ''active'' AND s.hire_date < CURRENT_DATE - 30 AND NOT EXISTS (SELECT 1 FROM public.staff_certifications sc WHERE sc.staff_id = s.id AND sc.deleted_at IS NULL AND sc.certification_type = ''tb_test'' AND sc.status IN (''active'',''pending_renewal'') AND (sc.expiration_date IS NULL OR sc.expiration_date >= CURRENT_DATE))', 'serious'),
    ('COL-HR-006', '30-Day CPR and First Aid', 'Active direct-care staff employed more than 30 days must have current CPR/First Aid evidence on file.', 'SELECT COUNT(*) = 0 FROM public.staff s WHERE s.facility_id = (SELECT id FROM facilities LIMIT 1) AND s.deleted_at IS NULL AND s.employment_status = ''active'' AND s.hire_date < CURRENT_DATE - 30 AND s.staff_role = ANY(ARRAY[''cna'',''lpn'',''rn'',''medication_tech'',''resident_aide'']::staff_role[]) AND NOT EXISTS (SELECT 1 FROM public.staff_certifications sc WHERE sc.staff_id = s.id AND sc.deleted_at IS NULL AND sc.certification_type IN (''cpr_first_aid'',''cpr'',''first_aid'') AND sc.status IN (''active'',''pending_renewal'') AND (sc.expiration_date IS NULL OR sc.expiration_date >= CURRENT_DATE))', 'serious'),
    ('COL-HR-007', 'Background Screening Clear', 'Active staff must have a clear current background screening record.', 'SELECT COUNT(*) = 0 FROM public.staff s WHERE s.facility_id = (SELECT id FROM facilities LIMIT 1) AND s.deleted_at IS NULL AND s.employment_status = ''active'' AND NOT EXISTS (SELECT 1 FROM public.staff_background_checks sbc WHERE sbc.staff_id = s.id AND sbc.deleted_at IS NULL AND sbc.result = ''clear'' AND (sbc.expires_at IS NULL OR sbc.expires_at >= CURRENT_DATE))', 'immediate_jeopardy'),
    ('COL-HR-008', 'Medication Tech Attestation', 'Active medication technicians must have annual med-tech self-attestation on file.', 'SELECT COUNT(*) = 0 FROM public.staff s WHERE s.facility_id = (SELECT id FROM facilities LIMIT 1) AND s.deleted_at IS NULL AND s.employment_status = ''active'' AND s.staff_role = ''medication_tech''::staff_role AND NOT EXISTS (SELECT 1 FROM public.staff_attestations sa WHERE sa.staff_id = s.id AND sa.deleted_at IS NULL AND sa.attestation_type = ''med_tech_self'' AND (sa.expires_at IS NULL OR sa.expires_at >= CURRENT_DATE))', 'serious'),
    ('COL-HR-009', 'Compliance Hold Review', 'Staff marked with unresolved compliance failure must be reviewed before launch.', 'SELECT COUNT(*) = 0 FROM public.staff s WHERE s.facility_id = (SELECT id FROM facilities LIMIT 1) AND s.deleted_at IS NULL AND s.employment_status = ''active'' AND s.compliance_failure_at IS NOT NULL AND (s.compliance_hold_until IS NULL OR s.compliance_hold_until >= CURRENT_DATE)', 'serious')
  ) AS v(tag_number, tag_title, rule_description, check_query, severity)
  WHERE f.organization_id = '00000000-0000-0000-0000-000000000001'
    AND f.deleted_at IS NULL
    AND f.name IN ('Oakridge ALF', 'Rising Oaks ALF', 'Homewood Lodge ALF', 'Plantation ALF', 'Grande Cypress ALF')
)
INSERT INTO public.compliance_rules (
  organization_id,
  facility_id,
  tag_number,
  tag_title,
  rule_description,
  check_query,
  severity,
  enabled
)
SELECT organization_id, facility_id, tag_number, tag_title, rule_description, check_query, severity, true
FROM rule_seed s
WHERE NOT EXISTS (
  SELECT 1
  FROM public.compliance_rules cr
  WHERE cr.facility_id = s.facility_id
    AND cr.tag_number = s.tag_number
    AND cr.deleted_at IS NULL
);

WITH route_seed AS (
  SELECT
    f.organization_id,
    f.id AS facility_id,
    v.name,
    v.severity_min::incident_severity AS severity_min,
    v.channels::text[] AS channels,
    v.staff_role_targets::staff_role[] AS staff_role_targets
  FROM public.facilities f
  CROSS JOIN (VALUES
    ('Quickmar Import Missed', 'level_3', ARRAY['email','sms'], ARRAY['administrator','assistant_administrator','coo','cfo','owner']),
    ('Activity Count Below Threshold', 'level_2', ARRAY['email','in_app'], ARRAY['administrator','assistant_administrator','activities_director','coo']),
    ('Employee Non-Compliant', 'level_3', ARRAY['email','sms'], ARRAY['administrator','assistant_administrator','coo','owner']),
    ('Snack Log Missed', 'level_1', ARRAY['in_app'], ARRAY['administrator','assistant_administrator','dietary_manager']),
    ('Round Check Overdue', 'level_2', ARRAY['email','push'], ARRAY['administrator','assistant_administrator','resident_services_coordinator']),
    ('Round Check 30 Min Overdue', 'level_3', ARRAY['sms','push'], ARRAY['administrator','assistant_administrator','resident_services_coordinator','coo']),
    ('Round Check 60 Min Overdue', 'level_4', ARRAY['sms','push','call'], ARRAY['administrator','assistant_administrator','coo','owner']),
    ('Inspection Due Soon', 'level_2', ARRAY['email'], ARRAY['administrator','assistant_administrator','maintenance_director','coo']),
    ('Drill Count Below Annual Target', 'level_3', ARRAY['email'], ARRAY['administrator','assistant_administrator','maintenance_director','coo','owner'])
  ) AS v(name, severity_min, channels, staff_role_targets)
  WHERE f.organization_id = '00000000-0000-0000-0000-000000000001'
    AND f.deleted_at IS NULL
    AND f.name IN ('Oakridge ALF', 'Rising Oaks ALF', 'Homewood Lodge ALF', 'Plantation ALF', 'Grande Cypress ALF')
)
INSERT INTO public.notification_routes (
  organization_id,
  facility_id,
  name,
  severity_min,
  channels,
  staff_role_targets,
  is_active
)
SELECT organization_id, facility_id, name, severity_min, channels, staff_role_targets, true
FROM route_seed s
WHERE NOT EXISTS (
  SELECT 1
  FROM public.notification_routes nr
  WHERE nr.organization_id = s.organization_id
    AND nr.facility_id = s.facility_id
    AND nr.name = s.name
    AND nr.deleted_at IS NULL
);

INSERT INTO public.role_permissions (app_role, feature, permission_level, description)
VALUES
  ('owner', 'staff_compliance', 'admin', 'Full staff compliance and attestation administration'),
  ('org_admin', 'staff_compliance', 'admin', 'Org-level staff compliance administration'),
  ('facility_admin', 'staff_compliance', 'edit', 'Facility-level staff compliance management'),
  ('manager', 'staff_compliance', 'edit', 'Facility manager staff compliance management'),
  ('nurse', 'staff_compliance', 'edit', 'Clinical staff compliance review'),
  ('caregiver', 'staff_compliance', 'view', 'View own staff compliance requirements'),
  ('owner', 'notification_routes', 'admin', 'Full notification route administration'),
  ('org_admin', 'notification_routes', 'admin', 'Org-level notification route administration'),
  ('facility_admin', 'notification_routes', 'edit', 'Facility notification route management'),
  ('manager', 'notification_routes', 'view', 'View facility notification routes')
ON CONFLICT (app_role, feature, permission_level) DO UPDATE SET
  description = EXCLUDED.description,
  updated_at = now();

COMMENT ON TABLE public.staff_facility_assignments IS 'Optional COL multi-facility staff assignment map; staff.facility_id remains the home/primary facility for legacy compatibility.';
COMMENT ON TABLE public.staff_attestations IS 'Signed staff attestations for med-tech preparedness and other recurring compliance statements.';
