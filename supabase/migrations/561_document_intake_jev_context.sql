-- COL-771 (DI-09): Jev full strength. The Document Intake worker's subjects
-- RPC carries the context the per-type code checks and Jev's facility
-- questions need:
--   - residents also carry admission_date (Form 1823 exam timing, face sheet
--     admission date check);
--   - facility also carries legal_name, dba, city, ahca_license_number,
--     ahca_license_expiration and total_licensed_beds (license number and
--     capacity checks; the receiving facility Jev compares names against);
--   - org_facilities: {id, name, legal_name, dba, city} for every non-deleted
--     facility in the item's organization, so Jev can tell a sister Circle of
--     Life building from this one.
-- Same signature, same SECURITY DEFINER, same search_path, same grants
-- (service_role only). No other change.

BEGIN;

-- Candidate subjects for one item. Names only for the item's own facility; the
-- worker ranks them in code and sends a short list, never the whole roster.
CREATE OR REPLACE FUNCTION public.document_intake_worker_subjects(p_item uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'residents', coalesce((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'first_name', r.first_name, 'last_name', r.last_name,
        'preferred_name', r.preferred_name, 'date_of_birth', r.date_of_birth, 'admission_date', r.admission_date, 'status', r.status))
      FROM public.residents r WHERE r.facility_id = i.facility_id AND r.organization_id = i.organization_id AND r.deleted_at IS NULL), '[]'::jsonb),
    'staff', coalesce((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'first_name', s.first_name, 'last_name', s.last_name,
        'preferred_name', s.preferred_name, 'employment_status', s.employment_status))
      FROM public.staff s WHERE s.organization_id = i.organization_id AND s.deleted_at IS NULL
        AND (s.facility_id = i.facility_id OR EXISTS (SELECT 1 FROM public.staff_facility_assignments x WHERE x.staff_id = s.id AND x.facility_id = i.facility_id AND x.deleted_at IS NULL))), '[]'::jsonb),
    'medicaid_cases', coalesce((SELECT jsonb_agg(jsonb_build_object('id', b.id, 'resident_id', b.resident_id, 'program', b.program, 'status', b.status))
      FROM public.benefits_cases b WHERE b.facility_id = i.facility_id AND b.organization_id = i.organization_id AND b.status <> 'closed'), '[]'::jsonb),
    'facility', (SELECT jsonb_build_object('id', f.id, 'name', f.name, 'legal_name', f.legal_name, 'dba', f.dba, 'city', f.city,
        'ahca_license_number', f.ahca_license_number, 'ahca_license_expiration', f.ahca_license_expiration,
        'total_licensed_beds', f.total_licensed_beds)
      FROM public.facilities f WHERE f.id = i.facility_id),
    'org_facilities', coalesce((SELECT jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'legal_name', f.legal_name, 'dba', f.dba, 'city', f.city) ORDER BY f.name, f.id)
      FROM public.facilities f WHERE f.organization_id = i.organization_id AND f.deleted_at IS NULL), '[]'::jsonb))
  FROM public.document_intake_items i WHERE i.id = p_item;
$$;

COMMENT ON FUNCTION public.document_intake_worker_subjects(uuid) IS 'COL-771. COL-37 ruling: definer required; the Document Intake worker runs as service_role only (authenticated and anon are revoked) and reads names, dates of birth and admission dates for the item''s own facility plus the organization''s facility names, so the worker can rank candidates in code and send Jev a short list.';

REVOKE ALL ON FUNCTION public.document_intake_worker_subjects(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.document_intake_worker_subjects(uuid) TO service_role;

COMMIT;
NOTIFY pgrst, 'reload schema';
