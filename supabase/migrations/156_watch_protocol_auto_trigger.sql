-- Migration 156: Auto-trigger watch protocols from incidents
-- When a fall/elopement/wandering incident is created, automatically create
-- a resident_watch_instance from matching watch_protocols.
-- Implements Florida AHCA post-fall enhanced monitoring requirement.

CREATE OR REPLACE FUNCTION public.auto_trigger_watch_protocol()
RETURNS TRIGGER AS $$
DECLARE
  v_trigger_type text;
  v_protocol record;
  v_total_minutes integer;
  v_step jsonb;
BEGIN
  -- Map incident category to watch trigger type
  CASE NEW.incident_type
    WHEN 'fall_with_injury', 'fall_without_injury', 'fall_witnessed', 'fall_unwitnessed' THEN
      v_trigger_type := 'incident_fall';
    WHEN 'elopement' THEN
      v_trigger_type := 'incident_elopement';
    WHEN 'wandering' THEN
      v_trigger_type := 'incident_wandering';
    ELSE
      RETURN NEW; -- No watch trigger for this incident type
  END CASE;

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
    -- Calculate total watch duration from protocol steps
    v_total_minutes := 0;
    IF v_protocol.rule_definition_json IS NOT NULL
       AND v_protocol.rule_definition_json ? 'steps' THEN
      FOR v_step IN SELECT * FROM jsonb_array_elements(v_protocol.rule_definition_json -> 'steps')
      LOOP
        v_total_minutes := v_total_minutes + COALESCE((v_step ->> 'duration_minutes')::integer, 60);
      END LOOP;
    END IF;

    -- Default to 24 hours if no steps defined
    IF v_total_minutes = 0 THEN
      v_total_minutes := 1440;
    END IF;

    -- Create watch instance
    INSERT INTO public.resident_watch_instances (
      organization_id, entity_id, facility_id, resident_id,
      protocol_id, triggered_by_type, triggered_by_id,
      starts_at, ends_at, status
    ) VALUES (
      NEW.organization_id, NEW.entity_id, NEW.facility_id, NEW.resident_id,
      v_protocol.id, v_trigger_type, NEW.id,
      now(),
      now() + (v_total_minutes || ' minutes')::interval,
      CASE WHEN v_protocol.approval_required THEN 'pending_approval'::public.resident_watch_status
           ELSE 'active'::public.resident_watch_status END
    );

    -- Log the watch event
    INSERT INTO public.resident_watch_events (
      organization_id, entity_id, facility_id, resident_id,
      watch_instance_id, event_type, occurred_at, note, created_by
    ) VALUES (
      NEW.organization_id, NEW.entity_id, NEW.facility_id, NEW.resident_id,
      (SELECT id FROM public.resident_watch_instances
       WHERE triggered_by_id = NEW.id ORDER BY created_at DESC LIMIT 1),
      'watch_auto_triggered',
      now(),
      format('Auto-triggered %s watch from incident %s (%s)', v_trigger_type, NEW.id, NEW.incident_type),
      NEW.created_by
    );
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Attach trigger to incidents table
DROP TRIGGER IF EXISTS tr_incidents_auto_watch ON public.incidents;
CREATE TRIGGER tr_incidents_auto_watch
  AFTER INSERT ON public.incidents
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_trigger_watch_protocol();

COMMENT ON FUNCTION public.auto_trigger_watch_protocol() IS
  'Auto-creates resident_watch_instances when fall/elopement/wandering incidents are reported. Implements FL AHCA post-fall monitoring.';
