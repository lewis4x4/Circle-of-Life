-- COL-740: new hires sign that they have read and understand the P&P manuals.
--
-- Brian's ruling (2026-09-24): "Whenever we are hiring a new employee ... there
-- should be something that they have to sign, saying that they've read it and
-- understand it." Onboarding only: existing staff are never flagged and nobody
-- re-signs.
--
-- The manuals are the knowledge base's policy documents (public.documents,
-- listed on the Policy Library since COL-707 / #859). The sign-off lives in the
-- existing employee file (335): it shows there, and an unsigned required manual
-- blocks duty readiness the same way a missing requirement does. This is not a
-- second onboarding flow.
--
-- Which manuals each job role must sign is configuration, in the shape of
-- staff_certification_requirements (489) / med_tech_shift_rules (476): append
-- only, effective-dated, organization default (facility_id NULL) with a
-- per-facility override, a reason on every change, required = false to drop.
-- The job role is staff.staff_role (a job title), not the login app_role.
--
-- "Onboarding only" is expressed by dates, not by a flag: a staff member must
-- sign the manuals whose rule was in force on their hire date. Anyone hired
-- before a rule took effect is never required to sign it, and a rule change
-- after someone's hire date does not reach them. A sign-off is per manual, not
-- per manual version, so a revised manual never asks anyone to sign again.
--
-- Nothing is seeded. Until an admin records a rule, nobody is asked to sign
-- anything and the employee file shows no manual section.

BEGIN;

-- ---------------------------------------------------------------------------
-- Which job roles must sign which manuals at onboarding
-- ---------------------------------------------------------------------------
CREATE TABLE public.onboarding_manual_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NULL REFERENCES public.facilities(id),
  staff_role public.staff_role NOT NULL,
  document_id uuid NOT NULL REFERENCES public.documents(id),
  required boolean NOT NULL,
  effective_from timestamptz NOT NULL,
  change_reason text NOT NULL CHECK (char_length(btrim(change_reason)) BETWEEN 1 AND 500),
  created_by uuid NULL REFERENCES public.user_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_onboarding_manual_requirements_scope_effective
  ON public.onboarding_manual_requirements (organization_id, facility_id, staff_role, document_id, effective_from)
  NULLS NOT DISTINCT;
CREATE INDEX idx_onboarding_manual_requirements_org_role
  ON public.onboarding_manual_requirements (organization_id, staff_role);

COMMENT ON TABLE public.onboarding_manual_requirements IS
  'COL-740. Which knowledge-base P&P manuals (documents) a job role (staff.staff_role) must sign at onboarding. Applies to staff whose hire date falls on or after the rule''s effective_from. facility_id NULL is the organization default; a facility row overrides it. Append only; required = false drops a manual.';

REVOKE ALL ON public.onboarding_manual_requirements FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.onboarding_manual_requirements TO authenticated;
GRANT ALL ON public.onboarding_manual_requirements TO service_role;
ALTER TABLE public.onboarding_manual_requirements ENABLE ROW LEVEL SECURITY;

CREATE POLICY onboarding_manual_requirements_read ON public.onboarding_manual_requirements
  FOR SELECT TO authenticated
  USING (
    organization_id = (SELECT haven.organization_id())
    AND (facility_id IS NULL OR facility_id IN (SELECT haven.accessible_facility_ids()))
  );

-- Owners and org admins set the organization default; they and facility admins
-- set a facility override for a building they can reach. No backdating.
CREATE POLICY onboarding_manual_requirements_insert ON public.onboarding_manual_requirements
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

-- A required manual must be a published knowledge-base policy document of the
-- same organization (the list the Policy Library shows). Machine-generated
-- knowledge-base entries are not manuals.
CREATE FUNCTION haven.onboarding_manual_requirement_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.facility_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.facilities f
    WHERE f.id = NEW.facility_id AND f.organization_id = NEW.organization_id AND f.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Facility is not in this organization' USING ERRCODE = '22023';
  END IF;
  IF NEW.required AND NOT EXISTS (
    SELECT 1 FROM public.documents d
    WHERE d.id = NEW.document_id
      AND d.workspace_id::text = NEW.organization_id::text
      AND d.deleted_at IS NULL
      AND d.status = 'published'
      AND coalesce(d.doc_type, '') NOT IN ('grace_pack', 'ontology_term', 'facility_override')
  ) THEN
    RAISE EXCEPTION 'A required manual must be a published knowledge-base policy document' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION haven.onboarding_manual_requirement_guard() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER tr_onboarding_manual_requirements_guard
  BEFORE INSERT ON public.onboarding_manual_requirements
  FOR EACH ROW EXECUTE FUNCTION haven.onboarding_manual_requirement_guard();

CREATE TRIGGER tr_onboarding_manual_requirements_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.onboarding_manual_requirements
  FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();

-- ---------------------------------------------------------------------------
-- The sign-offs: append only, one per staff member and manual
-- ---------------------------------------------------------------------------
CREATE TABLE public.onboarding_manual_signoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  staff_id uuid NOT NULL REFERENCES public.staff(id),
  document_id uuid NOT NULL REFERENCES public.documents(id),
  requirement_id uuid NOT NULL REFERENCES public.onboarding_manual_requirements(id),
  -- The manual as it stood when signed: its title, a SHA-256 of its text and
  -- its last-updated time. The knowledge base has no version number, so this
  -- is the version.
  document_title text NOT NULL,
  document_content_sha256 text NOT NULL CHECK (document_content_sha256 ~ '^[0-9a-f]{64}$'),
  document_updated_at timestamptz NULL,
  attestation text NOT NULL CHECK (char_length(btrim(attestation)) > 0),
  signature_name text NOT NULL CHECK (char_length(btrim(signature_name)) >= 3),
  -- self: the employee signed in their own login. in_person: a manager recorded
  -- the employee's signature given in person and is the witness.
  method text NOT NULL CHECK (method IN ('self', 'in_person')),
  signed_by uuid NOT NULL REFERENCES auth.users(id),
  signed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (staff_id, document_id)
);
CREATE INDEX idx_onboarding_manual_signoffs_facility ON public.onboarding_manual_signoffs (facility_id, staff_id);

COMMENT ON TABLE public.onboarding_manual_signoffs IS
  'COL-740. A new hire''s signed statement that they read and understand a required P&P manual. Append only; written only by haven_sign_onboarding_manual. The manual version is its content hash and updated_at at signing.';

REVOKE ALL ON public.onboarding_manual_signoffs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.onboarding_manual_signoffs TO authenticated;
GRANT ALL ON public.onboarding_manual_signoffs TO service_role;
ALTER TABLE public.onboarding_manual_signoffs ENABLE ROW LEVEL SECURITY;

-- The employee reads their own; managers read their buildings' (the employee
-- file's personnel reach, 335).
CREATE POLICY onboarding_manual_signoffs_read ON public.onboarding_manual_signoffs
  FOR SELECT TO authenticated
  USING (
    haven.employee_scope(organization_id, facility_id)
    AND (
      (SELECT haven.employee_manager())
      OR EXISTS (SELECT 1 FROM public.staff s WHERE s.id = staff_id AND s.user_id = (SELECT auth.uid()))
    )
  );

CREATE FUNCTION haven.onboarding_manual_signoff_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'Onboarding manual sign-offs are permanent' USING ERRCODE = '42501';
END $$;
REVOKE ALL ON FUNCTION haven.onboarding_manual_signoff_immutable() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER tr_onboarding_manual_signoffs_immutable
  BEFORE UPDATE OR DELETE ON public.onboarding_manual_signoffs
  FOR EACH ROW EXECUTE FUNCTION haven.onboarding_manual_signoff_immutable();

CREATE TRIGGER tr_onboarding_manual_signoffs_audit
  AFTER INSERT ON public.onboarding_manual_signoffs
  FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();

-- ---------------------------------------------------------------------------
-- Which manuals a staff member must sign: the rules in force on their hire date
-- ---------------------------------------------------------------------------
CREATE FUNCTION haven.onboarding_manuals_required(p_staff_id uuid)
RETURNS TABLE (document_id uuid, requirement_id uuid, required_from timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH s AS (
    SELECT st.id, st.organization_id, st.facility_id, st.staff_role,
           -- The end of the hire date on the facility clock: a rule in force at
           -- any point that day applies.
           ((st.hire_date + 1)::timestamp AT TIME ZONE 'America/New_York') AS cutoff
    FROM public.staff st
    WHERE st.id = p_staff_id AND st.deleted_at IS NULL
  ),
  in_force AS (
    SELECT DISTINCT ON (r.document_id)
           r.document_id, r.id AS requirement_id, r.required, r.effective_from
    FROM public.onboarding_manual_requirements r
    JOIN s ON r.organization_id = s.organization_id
          AND r.staff_role = s.staff_role
          AND (r.facility_id IS NULL OR r.facility_id = s.facility_id)
          AND r.effective_from < s.cutoff
    -- A facility rule overrides the organization default; then the latest.
    ORDER BY r.document_id, (r.facility_id IS NULL), r.effective_from DESC
  )
  SELECT f.document_id, f.requirement_id, f.effective_from
  FROM in_force f
  JOIN public.documents d ON d.id = f.document_id AND d.deleted_at IS NULL
  WHERE f.required
$$;
REVOKE ALL ON FUNCTION haven.onboarding_manuals_required(uuid) FROM PUBLIC, anon, authenticated;

-- Status for the employee file: every required manual, and its sign-off if any.
CREATE FUNCTION public.haven_onboarding_manual_status(p_staff_id uuid)
RETURNS TABLE (
  document_id uuid,
  document_title text,
  required_from timestamptz,
  signoff_id uuid,
  signed_at timestamptz,
  signature_name text,
  method text,
  signed_content_sha256 text,
  current_content_sha256 text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE s public.staff%ROWTYPE;
BEGIN
  SELECT * INTO s FROM public.staff WHERE id = p_staff_id AND deleted_at IS NULL;
  IF NOT FOUND OR auth.uid() IS NULL OR NOT coalesce(haven.employee_scope(s.organization_id, s.facility_id), false)
     OR NOT (haven.employee_manager() OR coalesce(s.user_id = auth.uid(), false)) THEN
    RAISE EXCEPTION 'Staff unavailable' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT q.document_id, d.title, q.required_from, so.id, so.signed_at, so.signature_name, so.method,
         so.document_content_sha256,
         encode(pg_catalog.sha256(convert_to(coalesce(d.markdown_text, d.raw_text, ''), 'UTF8')), 'hex')
  FROM haven.onboarding_manuals_required(s.id) q
  JOIN public.documents d ON d.id = q.document_id
  LEFT JOIN public.onboarding_manual_signoffs so ON so.staff_id = s.id AND so.document_id = q.document_id
  ORDER BY d.title;
END $$;
REVOKE ALL ON FUNCTION public.haven_onboarding_manual_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.haven_onboarding_manual_status(uuid) TO authenticated;

-- Who has and has not signed, for one building. Only staff who owe at least
-- one manual appear, so staff hired before any rule never show up.
CREATE FUNCTION public.haven_onboarding_manual_overview(p_facility_id uuid)
RETURNS TABLE (staff_id uuid, first_name text, last_name text, staff_role text, hire_date date,
               required_count integer, signed_count integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_org uuid;
BEGIN
  SELECT organization_id INTO v_org FROM public.facilities WHERE id = p_facility_id AND deleted_at IS NULL;
  IF auth.uid() IS NULL OR v_org IS NULL OR NOT coalesce(haven.employee_scope(v_org, p_facility_id), false)
     OR NOT haven.employee_manager() THEN
    RAISE EXCEPTION 'Onboarding overview unavailable' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT st.id, st.first_name, st.last_name, st.staff_role::text, st.hire_date,
         count(q.document_id)::integer,
         count(so.id)::integer
  FROM public.staff st
  CROSS JOIN LATERAL haven.onboarding_manuals_required(st.id) q
  LEFT JOIN public.onboarding_manual_signoffs so ON so.staff_id = st.id AND so.document_id = q.document_id
  WHERE st.facility_id = p_facility_id AND st.deleted_at IS NULL
  GROUP BY st.id, st.first_name, st.last_name, st.staff_role, st.hire_date
  ORDER BY st.hire_date DESC, st.last_name, st.first_name;
END $$;
REVOKE ALL ON FUNCTION public.haven_onboarding_manual_overview(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.haven_onboarding_manual_overview(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Signing
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.haven_sign_onboarding_manual(
  p_staff_id uuid, p_document_id uuid, p_signature_name text, p_method text, p_attestation text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s public.staff%ROWTYPE;
  d public.documents%ROWTYPE;
  v_requirement uuid;
  v_self boolean;
  v_row public.onboarding_manual_signoffs%ROWTYPE;
  v_text text;
BEGIN
  SELECT * INTO s FROM public.staff WHERE id = p_staff_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL OR NOT coalesce(haven.employee_scope(s.organization_id, s.facility_id), false) THEN
    RAISE EXCEPTION 'Staff unavailable' USING ERRCODE = '42501';
  END IF;
  v_self := coalesce(s.user_id = auth.uid(), false);
  IF p_method = 'self' THEN
    IF NOT v_self THEN RAISE EXCEPTION 'Only the employee can sign in their own name' USING ERRCODE = '42501'; END IF;
  ELSIF p_method = 'in_person' THEN
    -- A manager records a signature the employee gave in person and witnesses
    -- it; nobody witnesses their own.
    IF NOT haven.employee_manager() OR v_self THEN RAISE EXCEPTION 'An independent manager must witness an in-person signature' USING ERRCODE = '42501'; END IF;
  ELSE
    RAISE EXCEPTION 'Unsupported signing method' USING ERRCODE = '22023';
  END IF;
  IF char_length(btrim(coalesce(p_signature_name, ''))) < 3 THEN RAISE EXCEPTION 'Signature name required' USING ERRCODE = '22023'; END IF;
  IF char_length(btrim(coalesce(p_attestation, ''))) = 0 THEN RAISE EXCEPTION 'Attestation required' USING ERRCODE = '22023'; END IF;

  SELECT q.requirement_id INTO v_requirement FROM haven.onboarding_manuals_required(s.id) q WHERE q.document_id = p_document_id;
  IF v_requirement IS NULL THEN RAISE EXCEPTION 'This manual is not required for this employee' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.onboarding_manual_signoffs WHERE staff_id = s.id AND document_id = p_document_id) THEN
    RAISE EXCEPTION 'This manual is already signed' USING ERRCODE = '23505';
  END IF;

  SELECT * INTO d FROM public.documents WHERE id = p_document_id AND deleted_at IS NULL;
  v_text := coalesce(d.markdown_text, d.raw_text, '');
  IF NOT FOUND OR char_length(btrim(v_text)) = 0 THEN RAISE EXCEPTION 'The manual has no text to sign' USING ERRCODE = '22023'; END IF;

  INSERT INTO public.onboarding_manual_signoffs (
    organization_id, facility_id, staff_id, document_id, requirement_id, document_title,
    document_content_sha256, document_updated_at, attestation, signature_name, method, signed_by
  ) VALUES (
    s.organization_id, s.facility_id, s.id, d.id, v_requirement, d.title,
    encode(pg_catalog.sha256(convert_to(v_text, 'UTF8')), 'hex'), d.updated_at,
    btrim(p_attestation), btrim(p_signature_name), p_method, auth.uid()
  ) RETURNING * INTO v_row;

  INSERT INTO public.employee_file_audit_events (organization_id, facility_id, actor_id, action, entity_id)
  VALUES (s.organization_id, s.facility_id, auth.uid(), 'sign_onboarding_manual', v_row.id);

  RETURN to_jsonb(v_row);
END $$;
REVOKE ALL ON FUNCTION public.haven_sign_onboarding_manual(uuid, uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.haven_sign_onboarding_manual(uuid, uuid, text, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Duty readiness counts an unsigned required manual as missing (335 body,
-- plus the manual count), so a hire is not ready until the manuals are signed.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION haven.employee_duty_readiness_snapshot(p_staff_id uuid,p_duty text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.staff%ROWTYPE; q public.employee_file_requirements%ROWTYPE; v_duties text[]; v_configured text[]:='{}';
 v_today date:=(now() AT TIME ZONE 'America/New_York')::date; v_missing integer:=0; v_count integer; v_days integer; v_unconfigured integer; v_status text;
 v_manuals integer:=0;
BEGIN
 SELECT * INTO s FROM public.staff WHERE id=p_staff_id AND deleted_at IS NULL;
 IF NOT FOUND OR NOT coalesce(haven.employee_scope(s.organization_id,s.facility_id),false) OR NOT haven.employee_manager() THEN RAISE EXCEPTION 'Staff duty assessment unavailable' USING ERRCODE='42501'; END IF;
 v_duties:=CASE p_duty WHEN 'resident_interaction' THEN ARRAY['resident_interaction'] WHEN 'personal_care' THEN ARRAY['resident_interaction','personal_care'] WHEN 'medication' THEN ARRAY['resident_interaction','personal_care','medication'] ELSE NULL END;
 IF v_duties IS NULL THEN RAISE EXCEPTION 'Supported duty required'; END IF;
 FOR q IN SELECT latest.* FROM (
  SELECT DISTINCT ON (code) r.* FROM public.employee_file_requirements r
  WHERE r.organization_id=s.organization_id AND r.facility_id=s.facility_id AND r.deleted_at IS NULL AND r.review_status<>'draft'
  ORDER BY code,version DESC
 ) latest WHERE latest.review_status='approved' AND latest.duty=ANY(v_duties)
  AND ('*'=ANY(latest.applies_to_staff_roles) OR s.staff_role::text=ANY(latest.applies_to_staff_roles)) LOOP
  v_configured:=array_append(v_configured,q.duty);
  SELECT count(*),count(DISTINCT completed_on) INTO v_count,v_days FROM public.employee_file_records r
   WHERE r.staff_id=s.id AND r.requirement_id=q.id AND r.organization_id=s.organization_id AND r.facility_id=s.facility_id
   AND r.deleted_at IS NULL AND r.status='verified' AND r.completed_on<=v_today
   AND (r.expires_on IS NULL OR r.expires_on>=v_today)
   AND (q.recurrence_status<>'recurring' OR r.expires_on IS NOT NULL);
  IF q.recurrence_status='unknown' OR q.minimum_completions IS NULL OR q.minimum_distinct_days IS NULL
   OR v_count<q.minimum_completions OR v_days<q.minimum_distinct_days THEN v_missing:=v_missing+1; END IF;
 END LOOP;
 SELECT count(*) INTO v_manuals FROM haven.onboarding_manuals_required(s.id) m
  WHERE NOT EXISTS(SELECT 1 FROM public.onboarding_manual_signoffs so WHERE so.staff_id=s.id AND so.document_id=m.document_id);
 SELECT count(*) INTO v_unconfigured FROM unnest(v_duties) needed WHERE NOT(needed=ANY(v_configured));
 v_status:=CASE WHEN s.employment_status<>'active' OR s.hire_date>v_today THEN 'blocked'
  WHEN v_unconfigured>0 THEN 'not_configured' WHEN v_missing>0 OR v_manuals>0 THEN 'blocked' ELSE 'ready' END;
 RETURN jsonb_build_object('assessed_at',now(),'basis','current_requirements_at_recording','status',v_status,'requires_review',v_status<>'ready','missing_count',v_missing+v_unconfigured+v_manuals);
END $$;
REVOKE ALL ON FUNCTION haven.employee_duty_readiness_snapshot(uuid,text) FROM PUBLIC,anon,authenticated;

COMMENT ON FUNCTION public.haven_onboarding_manual_status(uuid) IS
  'COL-740: the P&P manuals one staff member must sign at onboarding and their sign-offs. COL-37 ruling: definer required -- it hashes the knowledge-base text and resolves rules for the staff member''s role and hire date; the body checks auth.uid(), haven.employee_scope() and that the caller is the employee or a manager (haven.employee_manager()) before returning anything.';
COMMENT ON FUNCTION public.haven_onboarding_manual_overview(uuid) IS
  'COL-740: who has and has not signed their onboarding manuals in one building. COL-37 ruling: definer required -- it reads sign-offs across the building''s staff; the body checks auth.uid(), haven.employee_scope() for the facility and haven.employee_manager() first.';
COMMENT ON FUNCTION public.haven_sign_onboarding_manual(uuid, uuid, text, text, text) IS
  'COL-740: records a new hire''s signed statement for one required manual. COL-37 ruling: definer required -- onboarding_manual_signoffs has no INSERT grant, so the content hash, the requirement and the signer cannot be forged; the body checks auth.uid(), haven.employee_scope(), that self-signing is the employee''s own login and that an in-person signature is witnessed by an independent manager.';

COMMIT;

NOTIFY pgrst, 'reload schema';
