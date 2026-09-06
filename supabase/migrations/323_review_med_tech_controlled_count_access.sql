-- Slice33/34 explicitly includes med-tech count origination. Spec06 still limits
-- the independent incoming credential signer to nurse/caregiver.
CREATE POLICY med_tech_read_facility_counts ON public.controlled_substance_counts
FOR SELECT TO authenticated USING (
  organization_id=haven.organization_id() AND deleted_at IS NULL
  AND facility_id IN (SELECT haven.accessible_facility_ids())
  AND haven.app_role()='med_tech'
  AND EXISTS(SELECT 1 FROM public.user_profiles p WHERE p.id=auth.uid() AND p.organization_id=controlled_substance_counts.organization_id
    AND p.app_role='med_tech' AND p.is_active AND p.deleted_at IS NULL)
);
CREATE POLICY med_tech_originate_facility_counts ON public.controlled_substance_counts
FOR INSERT TO authenticated WITH CHECK (
  organization_id=haven.organization_id() AND facility_id IN (SELECT haven.accessible_facility_ids())
  AND haven.app_role()='med_tech' AND outgoing_staff_id=auth.uid()
  AND EXISTS(SELECT 1 FROM public.user_profiles p WHERE p.id=auth.uid() AND p.organization_id=controlled_substance_counts.organization_id
    AND p.app_role='med_tech' AND p.is_active AND p.deleted_at IS NULL)
  AND EXISTS(SELECT 1 FROM public.resident_medications m WHERE m.id=resident_medication_id
    AND m.facility_id=controlled_substance_counts.facility_id AND m.organization_id=controlled_substance_counts.organization_id
    AND m.status='active' AND m.controlled_schedule<>'non_controlled' AND m.deleted_at IS NULL)
);
GRANT SELECT,INSERT ON public.controlled_substance_counts TO authenticated;

CREATE OR REPLACE FUNCTION public.complete_verified_controlled_counts(
  p_count_ids uuid[], p_outgoing_id uuid, p_incoming_id uuid, p_facility_id uuid, p_organization_id uuid
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE c public.controlled_substance_counts; matched integer := 0;
BEGIN
  IF p_incoming_id = p_outgoing_id OR cardinality(p_count_ids) IS NULL OR cardinality(p_count_ids) = 0 THEN
    RAISE EXCEPTION 'Two different staff and at least one count are required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_profiles WHERE id=p_outgoing_id AND organization_id=p_organization_id
      AND app_role IN ('nurse','caregiver','med_tech') AND is_active AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Invalid outgoing count role';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_profiles WHERE id = p_incoming_id AND organization_id = p_organization_id
      AND app_role IN ('nurse', 'caregiver') AND is_active AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Invalid witness';
  END IF;
  IF (SELECT count(*) FROM public.user_profiles u WHERE u.id IN (p_outgoing_id,p_incoming_id)
      AND u.organization_id=p_organization_id AND u.is_active AND u.deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM public.facilities f WHERE f.id=p_facility_id AND f.organization_id=p_organization_id AND f.deleted_at IS NULL
        AND (u.app_role IN ('owner','org_admin') OR EXISTS (SELECT 1 FROM public.user_facility_access a WHERE a.user_id=u.id
          AND a.facility_id=f.id AND a.organization_id=p_organization_id AND a.revoked_at IS NULL)))) <> 2 THEN
    RAISE EXCEPTION 'Both staff must have active facility access';
  END IF;
  FOR c IN SELECT * FROM public.controlled_substance_counts WHERE id = ANY(p_count_ids) ORDER BY id FOR UPDATE LOOP
    IF c.organization_id <> p_organization_id OR c.facility_id <> p_facility_id OR c.outgoing_staff_id <> p_outgoing_id
       OR c.incoming_staff_id IS NOT NULL OR c.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Count is no longer available for signing'; END IF;
    matched := matched + 1;
  END LOOP;
  IF matched <> cardinality(p_count_ids) THEN RAISE EXCEPTION 'Count list must contain unique existing counts'; END IF;
  UPDATE public.controlled_substance_counts SET incoming_staff_id = p_incoming_id, incoming_signed_at = now() WHERE id = ANY(p_count_ids);
  INSERT INTO public.audit_log(table_name, record_id, action, new_data, user_id, organization_id, facility_id)
    SELECT 'controlled_substance_counts', id, 'UPDATE', jsonb_build_object('event','incoming_co_sign_verified',
      'incoming_staff_id',p_incoming_id,'outgoing_staff_id',p_outgoing_id), p_incoming_id, p_organization_id, p_facility_id
    FROM public.controlled_substance_counts WHERE id = ANY(p_count_ids);
END;
$$;
REVOKE ALL ON FUNCTION public.complete_verified_controlled_counts(uuid[],uuid,uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_verified_controlled_counts(uuid[],uuid,uuid,uuid,uuid) TO service_role;


-- A med-tech pass owner may request an eligible independent nurse/caregiver witness.
CREATE OR REPLACE FUNCTION public.record_verified_med_pass_witness(p_pass_id uuid,p_actor_id uuid,p_witness_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE mp public.med_passes; sig_id uuid := gen_random_uuid();
BEGIN
  IF p_actor_id = p_witness_id THEN RAISE EXCEPTION 'Independent witness required'; END IF;
  SELECT * INTO STRICT mp FROM public.med_passes WHERE id=p_pass_id AND deleted_at IS NULL FOR UPDATE;
  IF mp.status NOT IN ('pending','overdue') OR mp.administered_by <> p_actor_id THEN RAISE EXCEPTION 'Pass unavailable'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.med_tech_shifts WHERE id=mp.shift_id AND user_id=p_actor_id AND status='active' AND deleted_at IS NULL
    AND facility_id=mp.facility_id AND organization_id=mp.organization_id) THEN RAISE EXCEPTION 'Active shift required'; END IF;
  IF (SELECT count(*) FROM public.user_profiles u WHERE u.id IN (p_actor_id,p_witness_id) AND u.is_active AND u.deleted_at IS NULL
    AND u.organization_id=mp.organization_id
    AND ((u.id=p_actor_id AND u.app_role IN ('nurse','caregiver','med_tech'))
      OR (u.id=p_witness_id AND u.app_role IN ('nurse','caregiver')))
    AND EXISTS (SELECT 1 FROM public.user_facility_access a WHERE a.user_id=u.id AND a.facility_id=mp.facility_id
      AND a.organization_id=mp.organization_id AND a.revoked_at IS NULL)) <> 2 THEN RAISE EXCEPTION 'Both staff must have clinical facility access'; END IF;
  INSERT INTO public.witness_signatures(id,organization_id,facility_id,med_pass_id,witness_user_id,signature_method,signature_hash,device_id)
    VALUES(sig_id,mp.organization_id,mp.facility_id,mp.id,p_witness_id,'password',
      encode(sha256(convert_to(jsonb_build_object('receipt',sig_id,'pass',mp.id,'version',mp.updated_at,'actor',p_actor_id,'witness',p_witness_id)::text,'UTF8')),'hex'),
      'server-credential-verification');
  RETURN sig_id;
END;
$$;
REVOKE ALL ON FUNCTION public.record_verified_med_pass_witness(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_verified_med_pass_witness(uuid,uuid,uuid) TO service_role;
