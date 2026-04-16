-- Fix resident watch auto-trigger function for current incident schema
-- incidents now use `category` instead of `incident_type` and do not carry `entity_id`

CREATE OR REPLACE FUNCTION public.auto_trigger_watch_protocol()
RETURNS TRIGGER AS $$
DECLARE
  v_trigger_type text;
  v_protocol record;
  v_total_minutes integer;
  v_step jsonb;
  v_watch_instance_id uuid;
  v_entity_id uuid;
BEGIN
  IF NEW.resident_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Map incident category to watch trigger type
  CASE NEW.category
    WHEN 'fall_with_injury', 'fall_without_injury', 'fall_unwitnessed' THEN
      v_trigger_type := 'incident_fall';
    WHEN 'elopement' THEN
      v_trigger_type := 'incident_elopement';
    WHEN 'wandering' THEN
      v_trigger_type := 'incident_wandering';
    ELSE
      RETURN NEW; -- No watch trigger for this incident category
  END CASE;

  SELECT entity_id
  INTO v_entity_id
  FROM public.facilities
  WHERE id = NEW.facility_id;

  -- Find matching active watch protocol for this facility
  FOR v_protocol IN
    SELECT *
    FROM public.resident_watch_protocols
    WHERE facility_id = NEW.facility_id
      AND trigger_type = v_trigger_type
      AND active = true
      AND deleted_at IS NULL
    LIMIT 1
  LOOP
    v_total_minutes := 0;
    IF v_protocol.rule_definition_json IS NOT NULL
       AND v_protocol.rule_definition_json ? 'steps' THEN
      FOR v_step IN SELECT * FROM jsonb_array_elements(v_protocol.rule_definition_json -> 'steps')
      LOOP
        v_total_minutes := v_total_minutes + COALESCE((v_step ->> 'duration_minutes')::integer, 60);
      END LOOP;
    END IF;

    IF v_total_minutes = 0 THEN
      v_total_minutes := 1440;
      RAISE WARNING 'Watch protocol % has no duration steps; defaulting to 24h', v_protocol.id;
    END IF;

    INSERT INTO public.resident_watch_instances (
      organization_id, entity_id, facility_id, resident_id,
      protocol_id, triggered_by_type, triggered_by_id,
      starts_at, ends_at, status
    ) VALUES (
      NEW.organization_id, v_entity_id, NEW.facility_id, NEW.resident_id,
      v_protocol.id, v_trigger_type, NEW.id,
      now(),
      now() + (v_total_minutes || ' minutes')::interval,
      CASE WHEN v_protocol.approval_required THEN 'pending_approval'::public.resident_watch_status
           ELSE 'active'::public.resident_watch_status END
    )
    RETURNING id INTO v_watch_instance_id;

    IF v_watch_instance_id IS NULL THEN
      RAISE WARNING 'Watch instance creation returned NULL for incident %', NEW.id;
      CONTINUE;
    END IF;

    INSERT INTO public.resident_watch_events (
      organization_id, entity_id, facility_id, resident_id,
      watch_instance_id, event_type, occurred_at, note, created_by
    ) VALUES (
      NEW.organization_id, v_entity_id, NEW.facility_id, NEW.resident_id,
      v_watch_instance_id,
      'watch_auto_triggered',
      now(),
      format('Auto-triggered %s watch from incident %s (%s)', v_trigger_type, NEW.id, NEW.category),
      COALESCE(NEW.created_by, auth.uid())
    );
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
