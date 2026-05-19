SET search_path = public;

CREATE OR REPLACE FUNCTION public.promote_facility_launch_vendor_contacts(
  p_organization_id uuid,
  p_facility_id uuid,
  p_actor_user_id uuid,
  p_run_item_id uuid,
  p_table text,
  p_rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_created integer := 0;
  v_updated integer := 0;
  v_noop integer := 0;
  v_row jsonb;
  v_existing_id uuid;
  v_existing_before jsonb;
  v_existing_count integer;
  v_target_id uuid;
  v_source_vendor_id text;
  v_organization text;
  v_category text;
  v_phone text;
  v_after_value jsonb;
BEGIN
  IF lower(coalesce(p_table, '')) <> 'facility_vendors' THEN
    RAISE EXCEPTION 'Vendor contacts promotion table % is not allowed', p_table;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.organizations o
    WHERE o.id = p_organization_id
      AND o.deleted_at IS NULL
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.facilities f
    WHERE f.id = p_facility_id
      AND f.organization_id = p_organization_id
      AND f.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Vendor contacts promotion validation failed for facility % organization %', p_facility_id, p_organization_id;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_facility_id::text), hashtext('facility_launch_vendor_contacts'));

  FOR v_row IN
    SELECT value FROM jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
  LOOP
    v_source_vendor_id := nullif(trim(coalesce(v_row->>'source_vendor_id', '')), '');
    v_organization := nullif(trim(coalesce(v_row->>'organization', '')), '');
    v_category := nullif(trim(coalesce(v_row->>'category', '')), '');
    v_phone := nullif(trim(coalesce(v_row->>'phone', '')), '');

    v_existing_id := NULL;
    v_existing_before := NULL;

    IF v_source_vendor_id IS NOT NULL THEN
      SELECT count(*)
      INTO v_existing_count
      FROM public.facility_vendors v
      WHERE v.organization_id = p_organization_id
        AND v.facility_id = p_facility_id
        AND v.source_vendor_id = v_source_vendor_id
        AND v.deleted_at IS NULL;

      IF v_existing_count > 1 THEN
        RAISE EXCEPTION 'Duplicate active facility vendors for facility % source_vendor_id %', p_facility_id, v_source_vendor_id;
      END IF;

      SELECT v.id, to_jsonb(v.*)
      INTO v_existing_id, v_existing_before
      FROM public.facility_vendors v
      WHERE v.organization_id = p_organization_id
        AND v.facility_id = p_facility_id
        AND v.source_vendor_id = v_source_vendor_id
        AND v.deleted_at IS NULL;
    ELSE
      SELECT count(*)
      INTO v_existing_count
      FROM public.facility_vendors v
      WHERE v.organization_id = p_organization_id
        AND v.facility_id = p_facility_id
        AND v.source_vendor_id IS NULL
        AND v.organization = v_organization
        AND coalesce(v.category, '') = coalesce(v_category, '')
        AND coalesce(v.phone, '') = coalesce(v_phone, '')
        AND v.deleted_at IS NULL;

      IF v_existing_count > 1 THEN
        RAISE EXCEPTION 'Duplicate active facility vendors for facility % fallback key (organization/category/phone)', p_facility_id;
      END IF;

      SELECT v.id, to_jsonb(v.*)
      INTO v_existing_id, v_existing_before
      FROM public.facility_vendors v
      WHERE v.organization_id = p_organization_id
        AND v.facility_id = p_facility_id
        AND v.source_vendor_id IS NULL
        AND v.organization = v_organization
        AND coalesce(v.category, '') = coalesce(v_category, '')
        AND coalesce(v.phone, '') = coalesce(v_phone, '')
        AND v.deleted_at IS NULL;
    END IF;

    IF v_existing_id IS NULL THEN
      INSERT INTO public.facility_vendors (
        organization_id,
        facility_id,
        source_vendor_id,
        organization,
        category,
        primary_contact,
        phone,
        after_hours_phone,
        account_number,
        contract_status,
        insurance_required,
        escalation_owner,
        provenance,
        promoted_from_module_value_id,
        created_by,
        updated_by
      ) VALUES (
        p_organization_id,
        p_facility_id,
        v_source_vendor_id,
        v_organization,
        v_category,
        nullif(v_row->>'primary_contact', ''),
        v_phone,
        nullif(v_row->>'after_hours_phone', ''),
        nullif(v_row->>'account_number', ''),
        nullif(v_row->>'contract_status', ''),
        nullif(v_row->>'insurance_required', ''),
        nullif(v_row->>'escalation_owner', ''),
        coalesce(v_row->'provenance', '{}'::jsonb),
        nullif(v_row->>'promoted_from_module_value_id', '')::uuid,
        p_actor_user_id,
        p_actor_user_id
      ) RETURNING id INTO v_target_id;

      v_created := v_created + 1;

      IF p_run_item_id IS NOT NULL THEN
        INSERT INTO public.facility_launch_promotion_run_links (
          run_item_id,
          organization_id,
          facility_id,
          module_value_id,
          target_table,
          target_row_id,
          action,
          before_value,
          after_value
        ) VALUES (
          p_run_item_id,
          p_organization_id,
          p_facility_id,
          nullif(v_row->>'promoted_from_module_value_id', '')::uuid,
          'facility_vendors',
          v_target_id::text,
          'insert',
          NULL,
          jsonb_build_object(
            'organization_id', p_organization_id,
            'facility_id', p_facility_id,
            'source_vendor_id', v_source_vendor_id,
            'organization', v_organization,
            'category', v_category,
            'primary_contact', nullif(v_row->>'primary_contact', ''),
            'phone', v_phone,
            'after_hours_phone', nullif(v_row->>'after_hours_phone', ''),
            'account_number', nullif(v_row->>'account_number', ''),
            'contract_status', nullif(v_row->>'contract_status', ''),
            'insurance_required', nullif(v_row->>'insurance_required', ''),
            'escalation_owner', nullif(v_row->>'escalation_owner', ''),
            'provenance', coalesce(v_row->'provenance', '{}'::jsonb),
            'promoted_from_module_value_id', nullif(v_row->>'promoted_from_module_value_id', '')::uuid,
            'updated_by', p_actor_user_id
          )
        );
      END IF;
    ELSE
      v_after_value := jsonb_build_object(
        'source_vendor_id', v_source_vendor_id,
        'organization', v_organization,
        'category', v_category,
        'primary_contact', nullif(v_row->>'primary_contact', ''),
        'phone', v_phone,
        'after_hours_phone', nullif(v_row->>'after_hours_phone', ''),
        'account_number', nullif(v_row->>'account_number', ''),
        'contract_status', nullif(v_row->>'contract_status', ''),
        'insurance_required', nullif(v_row->>'insurance_required', ''),
        'escalation_owner', nullif(v_row->>'escalation_owner', ''),
        'provenance', coalesce(v_row->'provenance', '{}'::jsonb),
        'promoted_from_module_value_id', nullif(v_row->>'promoted_from_module_value_id', '')::uuid,
        'updated_by', p_actor_user_id
      );

      IF (
        v_existing_before->>'source_vendor_id' IS DISTINCT FROM v_after_value->>'source_vendor_id'
        OR v_existing_before->>'organization' IS DISTINCT FROM v_after_value->>'organization'
        OR v_existing_before->>'category' IS DISTINCT FROM v_after_value->>'category'
        OR v_existing_before->>'primary_contact' IS DISTINCT FROM v_after_value->>'primary_contact'
        OR v_existing_before->>'phone' IS DISTINCT FROM v_after_value->>'phone'
        OR v_existing_before->>'after_hours_phone' IS DISTINCT FROM v_after_value->>'after_hours_phone'
        OR v_existing_before->>'account_number' IS DISTINCT FROM v_after_value->>'account_number'
        OR v_existing_before->>'contract_status' IS DISTINCT FROM v_after_value->>'contract_status'
        OR v_existing_before->>'insurance_required' IS DISTINCT FROM v_after_value->>'insurance_required'
        OR v_existing_before->>'escalation_owner' IS DISTINCT FROM v_after_value->>'escalation_owner'
        OR coalesce(v_existing_before->'provenance', '{}'::jsonb) IS DISTINCT FROM coalesce(v_after_value->'provenance', '{}'::jsonb)
        OR nullif(v_existing_before->>'promoted_from_module_value_id', '')::uuid IS DISTINCT FROM nullif(v_after_value->>'promoted_from_module_value_id', '')::uuid
        OR nullif(v_existing_before->>'updated_by', '')::uuid IS DISTINCT FROM p_actor_user_id
      ) THEN
        UPDATE public.facility_vendors
        SET source_vendor_id = v_source_vendor_id,
            organization = v_organization,
            category = v_category,
            primary_contact = nullif(v_row->>'primary_contact', ''),
            phone = v_phone,
            after_hours_phone = nullif(v_row->>'after_hours_phone', ''),
            account_number = nullif(v_row->>'account_number', ''),
            contract_status = nullif(v_row->>'contract_status', ''),
            insurance_required = nullif(v_row->>'insurance_required', ''),
            escalation_owner = nullif(v_row->>'escalation_owner', ''),
            provenance = coalesce(v_row->'provenance', '{}'::jsonb),
            promoted_from_module_value_id = nullif(v_row->>'promoted_from_module_value_id', '')::uuid,
            updated_by = p_actor_user_id,
            updated_at = now()
        WHERE id = v_existing_id;

        v_updated := v_updated + 1;

        IF p_run_item_id IS NOT NULL THEN
          INSERT INTO public.facility_launch_promotion_run_links (
            run_item_id,
            organization_id,
            facility_id,
            module_value_id,
            target_table,
            target_row_id,
            action,
            before_value,
            after_value
          ) VALUES (
            p_run_item_id,
            p_organization_id,
            p_facility_id,
            nullif(v_row->>'promoted_from_module_value_id', '')::uuid,
            'facility_vendors',
            v_existing_id::text,
            'update',
            v_existing_before,
            v_after_value
          );
        END IF;
      ELSE
        v_noop := v_noop + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'created', v_created,
    'updated', v_updated,
    'noop', v_noop
  );
END;
$$;

REVOKE ALL ON FUNCTION public.promote_facility_launch_vendor_contacts(
  uuid, uuid, uuid, uuid, text, jsonb
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.promote_facility_launch_vendor_contacts(
  uuid, uuid, uuid, uuid, text, jsonb
) TO service_role;
