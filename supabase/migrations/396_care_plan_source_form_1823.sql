-- A care plan can record which Form 1823 it was drafted from.
--
-- form_1823_records has carried the structured April-2021 form since 386, and
-- the care-plan editor can now pre-fill from it. The plan keeps the link so
-- the page and the printout can say "Based on Form 1823 exam <date>", and so
-- a newer exam is visibly a reason to revisit the plan. The link is optional:
-- plans authored from the paper ISP have none.

ALTER TABLE public.care_plans
  ADD COLUMN source_form_1823_id uuid REFERENCES public.form_1823_records (id);
CREATE INDEX idx_care_plans_source_form_1823 ON public.care_plans (source_form_1823_id)
  WHERE source_form_1823_id IS NOT NULL AND deleted_at IS NULL;
COMMENT ON COLUMN public.care_plans.source_form_1823_id IS
  'The current Form 1823 record the version was drafted from, if any. Provenance only; the nurse still authors and signs the plan.';

-- Same contract as the 321 function plus the optional source. The old
-- signature stays for existing callers; both share one implementation.
CREATE OR REPLACE FUNCTION public.create_care_plan_revision_review(
  p_id uuid, p_resident_id uuid, p_previous_id uuid, p_effective date, p_review date, p_notes text, p_items jsonb,
  p_source_form_1823_id uuid
)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE r residents%ROWTYPE; previous care_plans%ROWTYPE; item jsonb; position integer:=0; request_hash text;
BEGIN
 IF auth.uid() IS NULL OR haven.app_role() NOT IN('owner','org_admin','facility_admin','nurse') THEN RAISE EXCEPTION 'Clinical plan author role required'; END IF;
 IF p_effective IS NULL OR p_review<p_effective OR p_review IS NULL OR p_items IS NULL OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items)<1 THEN RAISE EXCEPTION 'Effective date, review date and care needs are required'; END IF;
 SELECT * INTO STRICT r FROM residents WHERE id=p_resident_id AND deleted_at IS NULL FOR UPDATE;
 -- The source must be this resident's current Form 1823; anything else is a mislink, not a draft.
 IF p_source_form_1823_id IS NOT NULL AND NOT EXISTS(
   SELECT 1 FROM form_1823_records f WHERE f.id=p_source_form_1823_id AND f.resident_id=r.id AND f.is_current AND f.deleted_at IS NULL
 ) THEN RAISE EXCEPTION 'The Form 1823 named is not this resident''s current form'; END IF;
 request_hash:=md5(jsonb_build_object('resident',p_resident_id,'previous',p_previous_id,'effective',p_effective,'review',p_review,'notes',p_notes,'items',p_items,'source_form_1823',p_source_form_1823_id)::text);
 IF EXISTS(SELECT 1 FROM care_plans WHERE id=p_id AND resident_id=r.id AND created_by=auth.uid()) THEN
  IF NOT EXISTS(SELECT 1 FROM care_plans WHERE id=p_id AND creation_request_hash=request_hash) THEN RAISE EXCEPTION 'This care-plan request was saved with different content. Reload before revising'; END IF;
  RETURN p_id;
 END IF;
 IF p_previous_id IS NULL AND EXISTS(SELECT 1 FROM care_plans WHERE resident_id=r.id AND deleted_at IS NULL AND status<>'archived') THEN RAISE EXCEPTION 'Open the existing care plan to create a revision'; END IF;
 IF p_previous_id IS NOT NULL THEN
  SELECT * INTO STRICT previous FROM care_plans WHERE id=p_previous_id AND resident_id=r.id AND deleted_at IS NULL;
  IF previous.status='archived' THEN RAISE EXCEPTION 'Open the current care-plan version to revise it'; END IF;
  IF EXISTS(SELECT 1 FROM care_plans WHERE previous_version_id=previous.id AND status IN('draft','under_review') AND deleted_at IS NULL) THEN RAISE EXCEPTION 'A revision is already awaiting clinical review'; END IF;
 END IF;
 INSERT INTO care_plans(id,resident_id,facility_id,organization_id,version,status,effective_date,review_due_date,notes,previous_version_id,created_by,creation_request_hash,source_form_1823_id)
 VALUES(p_id,r.id,r.facility_id,r.organization_id,coalesce(previous.version,0)+1,'under_review',p_effective,p_review,p_notes,p_previous_id,auth.uid(),request_hash,p_source_form_1823_id);
 FOR item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
  IF nullif(trim(item->>'title'),'') IS NULL OR nullif(trim(item->>'description'),'') IS NULL THEN RAISE EXCEPTION 'Every care need requires a title and description'; END IF;
  INSERT INTO care_plan_items(care_plan_id,resident_id,facility_id,organization_id,category,title,description,assistance_level,frequency,goal,interventions,special_instructions,sort_order,created_by)
  VALUES(p_id,r.id,r.facility_id,r.organization_id,(item->>'category')::care_plan_item_category,item->>'title',item->>'description',(item->>'assistance_level')::assistance_level,item->>'frequency',item->>'goal',ARRAY(SELECT jsonb_array_elements_text(item->'interventions')),item->>'special_instructions',position,auth.uid());
  position:=position+1;
 END LOOP;
 RETURN p_id;
END $$;
REVOKE ALL ON FUNCTION public.create_care_plan_revision_review(uuid,uuid,uuid,date,date,text,jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_care_plan_revision_review(uuid,uuid,uuid,date,date,text,jsonb,uuid) TO authenticated;

-- The seven-argument form now delegates, so both paths hash and validate alike.
CREATE OR REPLACE FUNCTION public.create_care_plan_revision_review(p_id uuid,p_resident_id uuid,p_previous_id uuid,p_effective date,p_review date,p_notes text,p_items jsonb)
RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path=public,pg_temp AS $$
  SELECT public.create_care_plan_revision_review(p_id,p_resident_id,p_previous_id,p_effective,p_review,p_notes,p_items,NULL::uuid);
$$;

NOTIFY pgrst, 'reload schema';
