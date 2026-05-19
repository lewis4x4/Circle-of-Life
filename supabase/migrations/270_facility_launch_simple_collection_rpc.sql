SET search_path = public;

CREATE OR REPLACE FUNCTION public.promote_facility_launch_simple_collection(
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
  v_table text;
  v_existing_id uuid;
  v_existing_before jsonb;
  v_existing_count integer;
  v_target_id uuid;
  v_natural_key text;
  v_after_value jsonb;
BEGIN
  v_table := lower(coalesce(p_table, ''));
  IF v_table NOT IN (
    'incident_workflow_templates',
    'facility_kpi_definitions'
  ) THEN
    RAISE EXCEPTION 'Simple collection promotion table % is not allowed', p_table;
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
    RAISE EXCEPTION 'Simple collection promotion validation failed for facility % organization %', p_facility_id, p_organization_id;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_facility_id::text), hashtext('facility_launch_simple_collection'));

  FOR v_row IN
    SELECT value FROM jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
  LOOP
    IF v_table = 'incident_workflow_templates' THEN
      v_natural_key := nullif(trim(coalesce(v_row->>'incident_type', '')), '');
    ELSE
      v_natural_key := nullif(trim(coalesce(v_row->>'kpi_name', '')), '');
    END IF;

    IF v_natural_key IS NULL THEN
      CONTINUE;
    END IF;

    v_existing_id := NULL;
    v_existing_before := NULL;

    IF v_table = 'incident_workflow_templates' THEN
      SELECT count(*)
      INTO v_existing_count
      FROM public.incident_workflow_templates t
      WHERE t.organization_id = p_organization_id
        AND t.facility_id = p_facility_id
        AND t.incident_type = v_natural_key
        AND t.deleted_at IS NULL;

      IF v_existing_count > 1 THEN
        RAISE EXCEPTION 'Duplicate active incident workflow templates for facility % incident_type %', p_facility_id, v_natural_key;
      END IF;

      SELECT t.id, to_jsonb(t.*)
      INTO v_existing_id, v_existing_before
      FROM public.incident_workflow_templates t
      WHERE t.organization_id = p_organization_id
        AND t.facility_id = p_facility_id
        AND t.incident_type = v_natural_key
        AND t.deleted_at IS NULL;

      IF v_existing_id IS NULL THEN
        INSERT INTO public.incident_workflow_templates (
          organization_id,
          facility_id,
          source_template_id,
          incident_type,
          severity_rule,
          immediate_actions,
          family_notification_rule,
          state_reporting_threshold,
          claims_routing,
          investigation_owner,
          follow_up_cadence,
          provenance,
          promoted_from_module_value_id,
          created_by,
          updated_by
        ) VALUES (
          p_organization_id,
          p_facility_id,
          nullif(v_row->>'source_template_id', ''),
          v_natural_key,
          nullif(v_row->>'severity_rule', ''),
          nullif(v_row->>'immediate_actions', ''),
          nullif(v_row->>'family_notification_rule', ''),
          nullif(v_row->>'state_reporting_threshold', ''),
          nullif(v_row->>'claims_routing', ''),
          nullif(v_row->>'investigation_owner', ''),
          nullif(v_row->>'follow_up_cadence', ''),
          coalesce(v_row->'provenance', '{}'::jsonb),
          nullif(v_row->>'promoted_from_module_value_id', '')::uuid,
          p_actor_user_id,
          p_actor_user_id
        )
        RETURNING id INTO v_target_id;

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
            v_table,
            v_target_id::text,
            'insert',
            NULL,
            jsonb_build_object(
              'organization_id', p_organization_id,
              'facility_id', p_facility_id,
              'source_template_id', nullif(v_row->>'source_template_id', ''),
              'incident_type', v_natural_key,
              'severity_rule', nullif(v_row->>'severity_rule', ''),
              'immediate_actions', nullif(v_row->>'immediate_actions', ''),
              'family_notification_rule', nullif(v_row->>'family_notification_rule', ''),
              'state_reporting_threshold', nullif(v_row->>'state_reporting_threshold', ''),
              'claims_routing', nullif(v_row->>'claims_routing', ''),
              'investigation_owner', nullif(v_row->>'investigation_owner', ''),
              'follow_up_cadence', nullif(v_row->>'follow_up_cadence', ''),
              'provenance', coalesce(v_row->'provenance', '{}'::jsonb),
              'promoted_from_module_value_id', nullif(v_row->>'promoted_from_module_value_id', '')::uuid,
              'updated_by', p_actor_user_id
            )
          );
        END IF;
      ELSE
        v_after_value := jsonb_build_object(
          'source_template_id', nullif(v_row->>'source_template_id', ''),
          'incident_type', v_natural_key,
          'severity_rule', nullif(v_row->>'severity_rule', ''),
          'immediate_actions', nullif(v_row->>'immediate_actions', ''),
          'family_notification_rule', nullif(v_row->>'family_notification_rule', ''),
          'state_reporting_threshold', nullif(v_row->>'state_reporting_threshold', ''),
          'claims_routing', nullif(v_row->>'claims_routing', ''),
          'investigation_owner', nullif(v_row->>'investigation_owner', ''),
          'follow_up_cadence', nullif(v_row->>'follow_up_cadence', ''),
          'provenance', coalesce(v_row->'provenance', '{}'::jsonb),
          'promoted_from_module_value_id', nullif(v_row->>'promoted_from_module_value_id', '')::uuid,
          'updated_by', p_actor_user_id
        );

        IF (
          v_existing_before->>'source_template_id' IS DISTINCT FROM v_after_value->>'source_template_id'
          OR v_existing_before->>'severity_rule' IS DISTINCT FROM v_after_value->>'severity_rule'
          OR v_existing_before->>'immediate_actions' IS DISTINCT FROM v_after_value->>'immediate_actions'
          OR v_existing_before->>'family_notification_rule' IS DISTINCT FROM v_after_value->>'family_notification_rule'
          OR v_existing_before->>'state_reporting_threshold' IS DISTINCT FROM v_after_value->>'state_reporting_threshold'
          OR v_existing_before->>'claims_routing' IS DISTINCT FROM v_after_value->>'claims_routing'
          OR v_existing_before->>'investigation_owner' IS DISTINCT FROM v_after_value->>'investigation_owner'
          OR v_existing_before->>'follow_up_cadence' IS DISTINCT FROM v_after_value->>'follow_up_cadence'
          OR coalesce(v_existing_before->'provenance', '{}'::jsonb) IS DISTINCT FROM coalesce(v_after_value->'provenance', '{}'::jsonb)
          OR nullif(v_existing_before->>'promoted_from_module_value_id', '')::uuid IS DISTINCT FROM nullif(v_after_value->>'promoted_from_module_value_id', '')::uuid
          OR nullif(v_existing_before->>'updated_by', '')::uuid IS DISTINCT FROM p_actor_user_id
        ) THEN
          UPDATE public.incident_workflow_templates
          SET source_template_id = nullif(v_row->>'source_template_id', ''),
              severity_rule = nullif(v_row->>'severity_rule', ''),
              immediate_actions = nullif(v_row->>'immediate_actions', ''),
              family_notification_rule = nullif(v_row->>'family_notification_rule', ''),
              state_reporting_threshold = nullif(v_row->>'state_reporting_threshold', ''),
              claims_routing = nullif(v_row->>'claims_routing', ''),
              investigation_owner = nullif(v_row->>'investigation_owner', ''),
              follow_up_cadence = nullif(v_row->>'follow_up_cadence', ''),
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
              v_table,
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
    ELSE
      SELECT count(*)
      INTO v_existing_count
      FROM public.facility_kpi_definitions k
      WHERE k.organization_id = p_organization_id
        AND k.facility_id = p_facility_id
        AND k.kpi_name = v_natural_key
        AND k.deleted_at IS NULL;

      IF v_existing_count > 1 THEN
        RAISE EXCEPTION 'Duplicate active facility KPI definitions for facility % kpi_name %', p_facility_id, v_natural_key;
      END IF;

      SELECT k.id, to_jsonb(k.*)
      INTO v_existing_id, v_existing_before
      FROM public.facility_kpi_definitions k
      WHERE k.organization_id = p_organization_id
        AND k.facility_id = p_facility_id
        AND k.kpi_name = v_natural_key
        AND k.deleted_at IS NULL;

      IF v_existing_id IS NULL THEN
        INSERT INTO public.facility_kpi_definitions (
          organization_id,
          facility_id,
          source_kpi_id,
          kpi_name,
          business_question,
          data_source,
          owner,
          refresh_cadence,
          target,
          launch_threshold,
          action_if_off_track,
          provenance,
          promoted_from_module_value_id,
          created_by,
          updated_by
        ) VALUES (
          p_organization_id,
          p_facility_id,
          nullif(v_row->>'source_kpi_id', ''),
          v_natural_key,
          nullif(v_row->>'business_question', ''),
          nullif(v_row->>'data_source', ''),
          nullif(v_row->>'owner', ''),
          nullif(v_row->>'refresh_cadence', ''),
          nullif(v_row->>'target', ''),
          nullif(v_row->>'launch_threshold', ''),
          nullif(v_row->>'action_if_off_track', ''),
          coalesce(v_row->'provenance', '{}'::jsonb),
          nullif(v_row->>'promoted_from_module_value_id', '')::uuid,
          p_actor_user_id,
          p_actor_user_id
        )
        RETURNING id INTO v_target_id;

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
            v_table,
            v_target_id::text,
            'insert',
            NULL,
            jsonb_build_object(
              'organization_id', p_organization_id,
              'facility_id', p_facility_id,
              'source_kpi_id', nullif(v_row->>'source_kpi_id', ''),
              'kpi_name', v_natural_key,
              'business_question', nullif(v_row->>'business_question', ''),
              'data_source', nullif(v_row->>'data_source', ''),
              'owner', nullif(v_row->>'owner', ''),
              'refresh_cadence', nullif(v_row->>'refresh_cadence', ''),
              'target', nullif(v_row->>'target', ''),
              'launch_threshold', nullif(v_row->>'launch_threshold', ''),
              'action_if_off_track', nullif(v_row->>'action_if_off_track', ''),
              'provenance', coalesce(v_row->'provenance', '{}'::jsonb),
              'promoted_from_module_value_id', nullif(v_row->>'promoted_from_module_value_id', '')::uuid,
              'updated_by', p_actor_user_id
            )
          );
        END IF;
      ELSE
        v_after_value := jsonb_build_object(
          'source_kpi_id', nullif(v_row->>'source_kpi_id', ''),
          'kpi_name', v_natural_key,
          'business_question', nullif(v_row->>'business_question', ''),
          'data_source', nullif(v_row->>'data_source', ''),
          'owner', nullif(v_row->>'owner', ''),
          'refresh_cadence', nullif(v_row->>'refresh_cadence', ''),
          'target', nullif(v_row->>'target', ''),
          'launch_threshold', nullif(v_row->>'launch_threshold', ''),
          'action_if_off_track', nullif(v_row->>'action_if_off_track', ''),
          'provenance', coalesce(v_row->'provenance', '{}'::jsonb),
          'promoted_from_module_value_id', nullif(v_row->>'promoted_from_module_value_id', '')::uuid,
          'updated_by', p_actor_user_id
        );

        IF (
          v_existing_before->>'source_kpi_id' IS DISTINCT FROM v_after_value->>'source_kpi_id'
          OR v_existing_before->>'business_question' IS DISTINCT FROM v_after_value->>'business_question'
          OR v_existing_before->>'data_source' IS DISTINCT FROM v_after_value->>'data_source'
          OR v_existing_before->>'owner' IS DISTINCT FROM v_after_value->>'owner'
          OR v_existing_before->>'refresh_cadence' IS DISTINCT FROM v_after_value->>'refresh_cadence'
          OR v_existing_before->>'target' IS DISTINCT FROM v_after_value->>'target'
          OR v_existing_before->>'launch_threshold' IS DISTINCT FROM v_after_value->>'launch_threshold'
          OR v_existing_before->>'action_if_off_track' IS DISTINCT FROM v_after_value->>'action_if_off_track'
          OR coalesce(v_existing_before->'provenance', '{}'::jsonb) IS DISTINCT FROM coalesce(v_after_value->'provenance', '{}'::jsonb)
          OR nullif(v_existing_before->>'promoted_from_module_value_id', '')::uuid IS DISTINCT FROM nullif(v_after_value->>'promoted_from_module_value_id', '')::uuid
          OR nullif(v_existing_before->>'updated_by', '')::uuid IS DISTINCT FROM p_actor_user_id
        ) THEN
          UPDATE public.facility_kpi_definitions
          SET source_kpi_id = nullif(v_row->>'source_kpi_id', ''),
              business_question = nullif(v_row->>'business_question', ''),
              data_source = nullif(v_row->>'data_source', ''),
              owner = nullif(v_row->>'owner', ''),
              refresh_cadence = nullif(v_row->>'refresh_cadence', ''),
              target = nullif(v_row->>'target', ''),
              launch_threshold = nullif(v_row->>'launch_threshold', ''),
              action_if_off_track = nullif(v_row->>'action_if_off_track', ''),
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
              v_table,
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
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'created', v_created,
    'updated', v_updated,
    'noop', v_noop
  );
END;
$$;

REVOKE ALL ON FUNCTION public.promote_facility_launch_simple_collection(
  uuid, uuid, uuid, uuid, text, jsonb
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.promote_facility_launch_simple_collection(
  uuid, uuid, uuid, uuid, text, jsonb
) TO service_role;
