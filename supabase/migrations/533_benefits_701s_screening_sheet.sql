-- Created with supabase migration new; repository claim 533. COL-770 (Medicaid Amendment A, build 13).
-- The DOEA 701S telephone screening sheet, pre-filled only from this resident's own record. This returns the
-- facts the sheet may use (demographics, facility as living situation, Medicaid number, the latest screening's
-- income and assets, every Form 1823 on file with its diagnoses and ADLs, and the active medication count);
-- the app lays them out in the form's order and leaves everything else blank. Haven supplies no default or
-- canned answers. Opening the sheet is recorded in the case history, like reading a document.
BEGIN;

CREATE OR REPLACE FUNCTION haven.benefits_screening_sheet_internal(p_case_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a jsonb:=haven.benefits_actor(); c public.benefits_cases; r public.residents; f public.facilities; s public.benefits_admission_screenings; BEGIN
 c:=haven.benefits_assert_case(p_case_id,'read');
 SELECT * INTO r FROM public.residents WHERE id=c.resident_id AND deleted_at IS NULL;
 IF r.id IS NULL THEN RAISE EXCEPTION 'Resident unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO f FROM public.facilities WHERE id=r.facility_id;
 SELECT * INTO s FROM public.benefits_admission_screenings x WHERE x.resident_id=r.id ORDER BY x.answered_at DESC,x.created_at DESC LIMIT 1;
 INSERT INTO public.benefits_history(case_id,action,payload,revision,created_by) VALUES(c.id,'screening_sheet_view',jsonb_build_object('form','DOEA 701S'),c.revision,(a->>'id')::uuid);
 RETURN jsonb_build_object('case_id',c.id,
  'resident',jsonb_build_object('first_name',r.first_name,'middle_name',r.middle_name,'last_name',r.last_name,'date_of_birth',r.date_of_birth,
   'gender',r.gender::text,'phone',r.primary_phone),
  'facility',jsonb_build_object('name',f.name,'address_line_1',f.address_line_1,'city',f.city,'zip',f.zip),
  'medicaid_number',(SELECT p.medicaid_recipient_id FROM public.resident_payers p WHERE p.resident_id=r.id AND p.deleted_at IS NULL AND p.payer_type::text LIKE 'medicaid%'
    AND nullif(btrim(p.medicaid_recipient_id),'') IS NOT NULL ORDER BY p.effective_date DESC LIMIT 1),
  'screening',CASE WHEN s.id IS NULL THEN NULL ELSE jsonb_build_object('answered_at',s.answered_at,'monthly_income_cents',s.monthly_income_cents,'assets_cents',s.assets_cents) END,
  'forms_1823',coalesce((SELECT jsonb_agg(jsonb_build_object('id',x.id,'exam_date',x.exam_date,'status',x.status::text,'is_current',x.is_current,
     'diagnoses',CASE WHEN jsonb_typeof(x.medical_history->'diagnoses')='array' THEN x.medical_history->'diagnoses' ELSE '[]'::jsonb END,
     'adl_bathing',x.adl_bathing,'adl_dressing',x.adl_dressing,'adl_eating',x.adl_eating,'adl_toileting',x.adl_toileting,
     'adl_transferring',x.adl_transferring,'adl_walking',x.adl_walking,'medication_assistance',x.medication_assistance)
     ORDER BY x.exam_date DESC NULLS LAST,x.created_at DESC)
    FROM public.form_1823_records x WHERE x.resident_id=r.id AND x.deleted_at IS NULL),'[]'),
  'active_medication_count',(SELECT count(*) FROM public.resident_medications m WHERE m.resident_id=r.id AND m.deleted_at IS NULL AND m.status::text='active'
    AND (m.end_date IS NULL OR m.end_date>=(now() AT TIME ZONE 'America/New_York')::date)));
END $$;
REVOKE ALL ON FUNCTION haven.benefits_screening_sheet_internal(uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.benefits_screening_sheet(p_case_id uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT haven.benefits_screening_sheet_internal(p_case_id); $$;
REVOKE ALL ON FUNCTION public.benefits_screening_sheet(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.benefits_screening_sheet(uuid),haven.benefits_screening_sheet_internal(uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
