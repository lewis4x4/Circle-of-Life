-- Migration 158: Fix race condition in watch protocol auto-trigger
-- The original trigger (156) used a subquery to find the watch_instance_id
-- after insertion, which races against concurrent inserts.
-- Fix: use RETURNING id INTO to capture the ID directly.

CREATE OR REPLACE FUNCTION public.auto_trigger_watch_protocol()
RETURNS TRIGGER AS $$
DECLARE
  v_trigger_type text;
  v_protocol record;
  v_total_minutes integer;
  v_step jsonb;
  v_watch_instance_id uuid;
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
      RAISE WARNING 'Watch protocol % has no duration steps; defaulting to 24h', v_protocol.id;
    END IF;

    -- Create watch instance and capture the ID directly (fixes race condition)
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
    )
    RETURNING id INTO v_watch_instance_id;

    -- Safety check: ensure instance was created
    IF v_watch_instance_id IS NULL THEN
      RAISE WARNING 'Watch instance creation returned NULL for incident %', NEW.id;
      CONTINUE;
    END IF;

    -- Log the watch event using the captured ID (no subquery needed)
    INSERT INTO public.resident_watch_events (
      organization_id, entity_id, facility_id, resident_id,
      watch_instance_id, event_type, occurred_at, note, created_by
    ) VALUES (
      NEW.organization_id, NEW.entity_id, NEW.facility_id, NEW.resident_id,
      v_watch_instance_id,
      'watch_auto_triggered',
      now(),
      format('Auto-triggered %s watch from incident %s (%s)', v_trigger_type, NEW.id, NEW.incident_type),
      COALESCE(NEW.created_by, auth.uid())
    );
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.auto_trigger_watch_protocol() IS
  'Auto-creates resident_watch_instances when fall/elopement/wandering incidents are reported. Fixed: uses RETURNING INTO instead of subquery to prevent race condition. Implements FL AHCA post-fall monitoring.';

-- Add missing DELETE policies for migrations 154 and 155

-- Migration 154: exec_alert_rules soft-delete policy
DO $$ BEGIN
  CREATE POLICY "owner/org_admin soft delete alert rules"
    ON public.exec_alert_rules FOR UPDATE
    USING (
      organization_id = haven.organization_id()
      AND haven.app_role() IN ('owner', 'org_admin')
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Migration 155: resident_safety_scores update + soft-delete
DO $$ BEGIN
  CREATE POLICY "Managers update safety scores"
    ON public.resident_safety_scores FOR UPDATE
    USING (
      organization_id = haven.organization_id()
      AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin')
      AND facility_id IN (SELECT haven.accessible_facility_ids())
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
